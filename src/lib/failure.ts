import { AppError, newCorrelationId, type ErrorCode } from '@/lib/sentry/errors'
import { redact } from '@/lib/sentry/redact'

export interface SerializedError {
  code: ErrorCode | 'UNKNOWN'
  message: string
  correlationId: string
  /** Verbose diagnostics. Populated outside production only. */
  detail?: string
  retryAfterSeconds?: number
}

export interface FailureResult {
  error: SerializedError
  httpStatus: number
}

// One code path, one shape. A separate development-only response would mean the production one
// is never exercised until it matters.
const includeDetail = () => process.env.NODE_ENV !== 'production'

const HTTP_STATUS: Record<ErrorCode, number> = {
  CONFIG: 500,
  SENTRY_AUTH: 502,
  SENTRY_SCOPE: 502,
  SENTRY_NOT_FOUND: 502,
  SENTRY_RATE_LIMIT: 429,
  SENTRY_UPSTREAM: 502,
  SENTRY_TIMEOUT: 504,
  SENTRY_SCHEMA: 502,
  // Not a failure of anything upstream: the app declined to spend more.
  AGENT_BUDGET: 429,
}

export function describeFailure(error: unknown): FailureResult {
  if (error instanceof AppError) {
    return {
      httpStatus: HTTP_STATUS[error.code],
      error: {
        code: error.code,
        message: error.userMessage,
        correlationId: error.correlationId,
        retryAfterSeconds: error.retryAfterSeconds,
        ...(includeDetail() ? { detail: error.devDetail } : {}),
      },
    }
  }

  const correlationId = newCorrelationId()
  return {
    httpStatus: 500,
    error: {
      code: 'UNKNOWN',
      message: 'Something failed while loading Sentry data, and the cause was not recognised.',
      correlationId,
      // Never a stack trace: only the message, redacted, and only outside production.
      ...(includeDetail() && error instanceof Error
        ? { detail: redact(error.message) }
        : {}),
    },
  }
}
