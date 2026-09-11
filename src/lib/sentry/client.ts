import { z } from 'zod'
import { analysisConfig } from '@/lib/config/analysis.config'
import { serverEnvironment } from '@/lib/config/env'
import { sentryConfig } from '@/lib/config/sentry.config'
import { logUpstreamRequest } from '@/lib/log'
import {
  environmentsEndpoint,
  issuesEndpoint,
  projectsEndpoint,
  type IssuesQueryParams,
} from './endpoints'
import {
  SentryAuthError,
  SentryNotFoundError,
  SentryRateLimitError,
  SentryScopeError,
  SentrySchemaError,
  SentryTimeoutError,
  SentryUpstreamError,
  newCorrelationId,
} from './errors'
import { sentryEnvironmentSchema, sentryIssueSchema, sentryProjectSchema } from './schemas'
import type { SentryIssue, SentryProject } from './types'

export interface Paginated<T> {
  items: T[]
  /** True when Sentry still had pages left at maxPages. Surface it; do not swallow it. */
  truncated: boolean
  /**
   * When Sentry produced this data, from its Date header. A cached response keeps its original
   * date, which is the point: the UI must show how old the numbers are.
   */
  fetchedAt: string | null
}

interface RequestContext {
  correlationId: string
  operation: string
  project?: string
  window?: string
  environment?: string
}

const upstreamDetailSchema = z.object({ detail: z.string() })

const isRetryable = (status: number) => status === 429 || status >= 500

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Retry-After is either delta-seconds or an HTTP-date.
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined

  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds))

  const deadline = Date.parse(header)
  if (!Number.isFinite(deadline)) return undefined
  return Math.max(0, Math.round((deadline - Date.now()) / 1000))
}

async function readUpstreamDetail(response: Response): Promise<string> {
  try {
    const parsed = upstreamDetailSchema.safeParse(await response.clone().json())
    return parsed.success ? parsed.data.detail : ''
  } catch {
    return ''
  }
}

function failureFor(
  status: number,
  detail: string,
  context: RequestContext,
  retryAfterSeconds?: number,
): Error {
  const where = `${context.operation} (correlation ${context.correlationId})`
  // Sentry's own words go to devDetail and the server log only. Upstream bodies can carry org
  // and project internals and are never serialised to the client.
  const dev = `HTTP ${status} from Sentry during ${where}. Upstream detail: ${detail || '(none)'}`

  switch (status) {
    case 401:
      return new SentryAuthError(
        'Sentry rejected the credentials. SENTRY_AUTH_TOKEN may be expired or revoked.',
        dev,
        { correlationId: context.correlationId },
      )
    case 403:
      return new SentryScopeError(
        'The token is valid but lacks the required scopes, or cannot access this project. It needs project:read and event:read.',
        dev,
        { correlationId: context.correlationId },
      )
    case 404:
      return new SentryNotFoundError(
        'No project matching this selection in this organization.',
        dev,
        { correlationId: context.correlationId },
      )
    case 429:
      return new SentryRateLimitError(
        retryAfterSeconds === undefined
          ? 'Sentry rate limit reached.'
          : `Sentry rate limit reached; retry possible in ${retryAfterSeconds} seconds.`,
        dev,
        { correlationId: context.correlationId, retryAfterSeconds },
      )
    default:
      return new SentryUpstreamError(`Sentry returned an error (HTTP ${status}).`, dev, {
        correlationId: context.correlationId,
      })
  }
}

async function requestWithRetry(url: string, context: RequestContext): Promise<Response> {
  const { SENTRY_AUTH_TOKEN } = serverEnvironment()
  const startedAt = Date.now()

  for (let attempt = 0; ; attempt += 1) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(sentryConfig.requestTimeoutMs),
        next: { revalidate: analysisConfig.cacheSeconds },
      })
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : ''
      const timedOut = name === 'TimeoutError' || name === 'AbortError'
      logUpstreamRequest({
        ...context,
        durationMs: Date.now() - startedAt,
        attempts: attempt + 1,
        errorCode: timedOut ? 'SENTRY_TIMEOUT' : 'SENTRY_UPSTREAM',
      })

      const seconds = Math.round(sentryConfig.requestTimeoutMs / 1000)
      if (timedOut) {
        throw new SentryTimeoutError(
          `Could not reach Sentry within ${seconds}s.`,
          `Timed out calling ${context.operation} after ${sentryConfig.requestTimeoutMs}ms.`,
          { correlationId: context.correlationId, cause },
        )
      }
      throw new SentryUpstreamError(
        'Could not reach Sentry. Check connectivity and SENTRY_API_BASE_URL.',
        `Network failure calling ${context.operation}.`,
        { correlationId: context.correlationId, cause },
      )
    }

    if (response.ok) {
      logUpstreamRequest({
        ...context,
        upstreamStatus: response.status,
        durationMs: Date.now() - startedAt,
        attempts: attempt + 1,
      })
      return response
    }

    const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'))
    const canRetry = isRetryable(response.status) && attempt < sentryConfig.maxRetries

    if (!canRetry) {
      const detail = await readUpstreamDetail(response)
      const failure = failureFor(response.status, detail, context, retryAfterSeconds)
      logUpstreamRequest({
        ...context,
        upstreamStatus: response.status,
        durationMs: Date.now() - startedAt,
        attempts: attempt + 1,
        errorCode: failure instanceof Error ? failure.name : undefined,
      })
      throw failure
    }

    const backoff = sentryConfig.retryBaseDelayMs * 2 ** attempt
    const wait = Math.min(
      sentryConfig.maxRetryDelayMs,
      retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : backoff,
    )
    await delay(wait)
  }
}

const LINK_ENTRY = /<([^>]+)>\s*;\s*([^<]*)/g

/**
 * The cursor URL comes from a response header, and we attach the auth token to whatever it names.
 * Following it off-origin would hand the token to another host, so anything that is not the
 * configured Sentry origin ends pagination.
 */
function nextPageUrl(linkHeader: string | null, expectedOrigin: string): string | undefined {
  if (!linkHeader) return undefined

  for (const [, url, attributes] of linkHeader.matchAll(LINK_ENTRY)) {
    // Sentry always emits a next link; results="false" is how it says the page is empty.
    if (!/rel="?next"?/.test(attributes) || !/results="?true"?/.test(attributes)) continue

    try {
      if (new URL(url).origin === expectedOrigin) return url
    } catch {
      return undefined
    }
    return undefined
  }
  return undefined
}

function parseHttpDate(header: string | null): string | null {
  if (!header) return null
  const parsed = Date.parse(header)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

async function fetchAllPages<T>(
  firstPageUrl: string,
  itemSchema: z.ZodType<T>,
  context: RequestContext,
): Promise<Paginated<T>> {
  const pageSchema = z.array(itemSchema)
  const expectedOrigin = new URL(firstPageUrl).origin
  const items: T[] = []
  let url: string | undefined = firstPageUrl
  // The oldest page decides the reported age: the result is only as fresh as its stalest part.
  let fetchedAt: string | null = null

  for (let page = 0; page < sentryConfig.maxPages; page += 1) {
    const response = await requestWithRetry(url, context)

    let body: unknown
    try {
      body = await response.json()
    } catch (cause) {
      throw new SentrySchemaError(
        `${context.operation} response body`,
        `Sentry returned a non-JSON body (HTTP ${response.status}).`,
        { correlationId: context.correlationId, cause },
      )
    }

    const parsed = pageSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const fieldPath = `${context.operation}[${issue?.path.join('.') ?? '?'}]`
      throw new SentrySchemaError(
        fieldPath,
        `Schema mismatch: ${parsed.error.issues
          .slice(0, 5)
          .map((entry) => `${entry.path.join('.')}: ${entry.message}`)
          .join('; ')}`,
        { correlationId: context.correlationId },
      )
    }
    items.push(...parsed.data)

    const pageDate = parseHttpDate(response.headers.get('date'))
    if (pageDate && (!fetchedAt || pageDate < fetchedAt)) fetchedAt = pageDate

    url = nextPageUrl(response.headers.get('link'), expectedOrigin)
    if (!url) return { items, truncated: false, fetchedAt }
  }

  return { items, truncated: true, fetchedAt }
}

export async function fetchProjects(): Promise<Paginated<SentryProject>> {
  const { SENTRY_API_BASE_URL, SENTRY_ORG } = serverEnvironment()
  return fetchAllPages(projectsEndpoint(SENTRY_API_BASE_URL, SENTRY_ORG), sentryProjectSchema, {
    correlationId: newCorrelationId(),
    operation: 'projects',
  })
}

export async function fetchEnvironments(projectSlug: string): Promise<string[]> {
  const { SENTRY_API_BASE_URL, SENTRY_ORG } = serverEnvironment()
  const page = await fetchAllPages(
    environmentsEndpoint(SENTRY_API_BASE_URL, SENTRY_ORG, projectSlug),
    sentryEnvironmentSchema,
    { correlationId: newCorrelationId(), operation: 'environments', project: projectSlug },
  )
  return page.items.map((environment) => environment.name)
}

export interface IssueWindowRequest {
  projectId: string
  start: Date
  end: Date
  environment?: string
  query: string
  withStats: boolean
  windowLabel: string
}

export async function fetchIssueWindow(
  request: IssueWindowRequest,
): Promise<Paginated<SentryIssue>> {
  const { SENTRY_API_BASE_URL, SENTRY_ORG } = serverEnvironment()

  const params: IssuesQueryParams = {
    projectId: request.projectId,
    start: request.start,
    end: request.end,
    environment: request.environment,
    query: request.query,
    sort: sentryConfig.issueSort,
    limit: sentryConfig.pageLimit,
    withStats: request.withStats,
  }

  return fetchAllPages(issuesEndpoint(SENTRY_API_BASE_URL, SENTRY_ORG, params), sentryIssueSchema, {
    correlationId: newCorrelationId(),
    operation: `issues:${request.windowLabel}`,
    project: request.projectId,
    window: request.windowLabel,
    environment: request.environment,
  })
}
