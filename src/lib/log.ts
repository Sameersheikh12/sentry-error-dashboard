import { redact } from './sentry/redact'

export interface RequestLogEntry {
  correlationId: string
  operation: string
  project?: string
  window?: string
  environment?: string
  upstreamStatus?: number
  durationMs: number
  errorCode?: string
  attempts?: number
}

/** One structured line per upstream request, redacted centrally before it is written. */
export function logUpstreamRequest(entry: RequestLogEntry): void {
  console.log(JSON.stringify(redact({ at: new Date().toISOString(), ...entry })))
}
