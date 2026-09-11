export interface SentryConfig {
  /**
   * Sentry keeps a regressed issue at status "unresolved" with substatus "regressed", so
   * is:unresolved surfaces regressions alongside new and ongoing issues. It excludes archived
   * issues, which is what we want — someone deliberately silenced those.
   */
  issueQuery: string
  /** We rank ourselves; Sentry's order only needs to be stable for pagination. */
  issueSort: string
  /** Sentry caps the issues endpoint at 100 per page. */
  pageLimit: number
  /**
   * Hard stop on pagination. A project with tens of thousands of open issues would otherwise
   * walk every page on each fetch and exhaust the rate limit.
   */
  maxPages: number
  requestTimeoutMs: number
  /** Retries apply to 429 and 5xx only — a 4xx will not become a 2xx by asking again. */
  maxRetries: number
  retryBaseDelayMs: number
  /** Refuse to wait longer than this when Sentry sends a large Retry-After. */
  maxRetryDelayMs: number
}

export const sentryConfig: SentryConfig = {
  issueQuery: 'is:unresolved',
  issueSort: 'date',
  pageLimit: 100,
  maxPages: 20,
  requestTimeoutMs: 15_000,
  maxRetries: 2,
  retryBaseDelayMs: 500,
  maxRetryDelayMs: 5_000,
}
