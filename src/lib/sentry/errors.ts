import { randomUUID } from 'node:crypto'
import { redact } from './redact'

export type ErrorCode =
  | 'CONFIG'
  | 'SENTRY_AUTH'
  | 'SENTRY_SCOPE'
  | 'SENTRY_NOT_FOUND'
  | 'SENTRY_RATE_LIMIT'
  | 'SENTRY_UPSTREAM'
  | 'SENTRY_TIMEOUT'
  | 'SENTRY_SCHEMA'

export function newCorrelationId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

export interface AppErrorOptions {
  correlationId?: string
  retryAfterSeconds?: number
  cause?: unknown
}

/**
 * Every failure in the app is one of these. `userMessage` is safe to render anywhere;
 * `devDetail` is verbose and withheld outside development. Both are redacted here, so no caller
 * has to remember to do it.
 */
export abstract class AppError extends Error {
  abstract readonly code: ErrorCode
  readonly userMessage: string
  readonly devDetail: string
  readonly correlationId: string
  readonly retryAfterSeconds?: number

  constructor(userMessage: string, devDetail: string, options: AppErrorOptions = {}) {
    super(redact(userMessage), { cause: options.cause })
    this.name = new.target.name
    this.userMessage = redact(userMessage)
    this.devDetail = redact(devDetail)
    this.correlationId = options.correlationId ?? newCorrelationId()
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

export class ConfigError extends AppError {
  readonly code = 'CONFIG' as const
}

export class SentryAuthError extends AppError {
  readonly code = 'SENTRY_AUTH' as const
}

export class SentryScopeError extends AppError {
  readonly code = 'SENTRY_SCOPE' as const
}

export class SentryNotFoundError extends AppError {
  readonly code = 'SENTRY_NOT_FOUND' as const
}

export class SentryRateLimitError extends AppError {
  readonly code = 'SENTRY_RATE_LIMIT' as const
}

export class SentryUpstreamError extends AppError {
  readonly code = 'SENTRY_UPSTREAM' as const
}

export class SentryTimeoutError extends AppError {
  readonly code = 'SENTRY_TIMEOUT' as const
}

export class SentrySchemaError extends AppError {
  readonly code = 'SENTRY_SCHEMA' as const
  /** Diagnostic, not sensitive: it names a field path, never a value. */
  readonly fieldPath: string

  constructor(fieldPath: string, devDetail: string, options: AppErrorOptions = {}) {
    super(`Sentry returned an unexpected shape at ${fieldPath}.`, devDetail, options)
    this.fieldPath = fieldPath
  }
}
