import type { SerializedError } from '@/lib/failure'
import { DANGER_LABEL_TEXT, DANGER_SURFACE, FAINT_TEXT, MUTED_TEXT } from './controls'

interface FailureCopy {
  title: string
  action: string
}

// Every one of these is a state where the dashboard knows nothing. None of them may ever be
// mistaken for "all clear" — a calm empty screen on a failed fetch is the exact thing this app
// exists to prevent.
const COPY: Record<string, FailureCopy> = {
  SENTRY_AUTH: {
    title: 'Sentry rejected the credentials',
    action: 'SENTRY_AUTH_TOKEN may be expired or revoked. Issue a new one and restart.',
  },
  SENTRY_SCOPE: {
    title: 'Sentry refused access',
    action:
      'The token needs project:read and event:read, and must belong to an account that can see this project.',
  },
  SENTRY_NOT_FOUND: {
    title: 'No project matching this selection',
    action: 'Check SENTRY_ORG and the selected project.',
  },
  SENTRY_RATE_LIMIT: {
    title: 'Sentry rate limit reached',
    action: 'Wait for the retry window, or raise cacheSeconds so refreshes hit the cache.',
  },
  SENTRY_TIMEOUT: {
    title: 'Could not reach Sentry in time',
    action: 'Sentry may be degraded — check status.sentry.io.',
  },
  SENTRY_UPSTREAM: {
    title: 'Sentry returned an error',
    action: 'The request reached Sentry but failed. Retry shortly.',
  },
  SENTRY_SCHEMA: {
    title: "Sentry's response did not match the expected shape",
    action: 'The API has probably changed. Update lib/sentry/schemas.ts to match.',
  },
  CONFIG: {
    title: 'The app is not configured',
    action: 'Required environment variables are missing or invalid.',
  },
}

const FALLBACK: FailureCopy = {
  title: 'Could not load issues from Sentry',
  action: 'This page cannot tell you whether anything is wrong.',
}

export function ErrorState({ error }: { error: SerializedError }) {
  const copy = COPY[error.code] ?? FALLBACK

  return (
    <section className={`rounded-lg border-2 p-5 ${DANGER_SURFACE}`}>
      <p className={`text-xs font-semibold uppercase tracking-widest ${DANGER_LABEL_TEXT}`}>
        Sentry unreachable — this page is not showing you your errors
      </p>
      <h2 className="mt-2 text-lg font-semibold">{copy.title}</h2>
      <p className="mt-1 text-sm">{error.message}</p>
      <p className={`mt-1 text-sm ${MUTED_TEXT}`}>{copy.action}</p>

      {error.retryAfterSeconds !== undefined && (
        <p className="mt-1 text-sm">Sentry asked us to retry in {error.retryAfterSeconds}s.</p>
      )}

      <p className={`mt-3 text-xs ${FAINT_TEXT}`}>
        Correlation id <span className="font-mono">{error.correlationId}</span> — quote this to find
        the server log line.
      </p>

      {error.detail && (
        <pre className={`mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-slate-500/10 p-3 text-xs ${MUTED_TEXT}`}>
          {error.detail}
        </pre>
      )}
    </section>
  )
}
