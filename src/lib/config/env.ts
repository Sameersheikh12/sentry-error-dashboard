import { z } from 'zod'
import { ConfigError } from '@/lib/sentry/errors'

const requirements: Record<string, string> = {
  SENTRY_AUTH_TOKEN: 'a Sentry auth token with the project:read and event:read scopes',
  SENTRY_ORG: 'your Sentry organization slug',
  SENTRY_API_BASE_URL:
    "your Sentry region's API base URL, e.g. https://sentry.io, https://us.sentry.io or https://de.sentry.io",
  SENTRY_DEFAULT_PROJECT: 'optional: a Sentry project id to preselect in the dashboard',
  DASHBOARD_ACCESS_SECRET: 'optional: a shared secret (16+ chars) gating access when deployed',
  ALLOW_UNAUTHENTICATED: 'optional: set to "true" to run in production with no access gate',
}

const blankAsMissing = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

const environmentSchema = z.object({
  SENTRY_AUTH_TOKEN: z.preprocess(blankAsMissing, z.string().min(1)),
  SENTRY_ORG: z.preprocess(blankAsMissing, z.string().min(1)),
  SENTRY_API_BASE_URL: z.preprocess(
    blankAsMissing,
    z
      .url()
      .default('https://sentry.io')
      .transform((url) => url.replace(/\/+$/, '')),
  ),
  SENTRY_DEFAULT_PROJECT: z.preprocess(blankAsMissing, z.string().min(1).optional()),
  DASHBOARD_ACCESS_SECRET: z.preprocess(blankAsMissing, z.string().min(16).optional()),
  ALLOW_UNAUTHENTICATED: z.preprocess(blankAsMissing, z.string().optional()),
})

export type ServerEnvironment = z.infer<typeof environmentSchema>

let resolved: ServerEnvironment | undefined

// Resolved on first use rather than at module load so that `next build` does not require
// production secrets. The first Sentry call still fails loudly and names the missing variable,
// which is what "fail fast" is actually protecting against here.
export function serverEnvironment(): ServerEnvironment {
  if (resolved) return resolved

  const parsed = environmentSchema.safeParse({
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
    SENTRY_ORG: process.env.SENTRY_ORG,
    SENTRY_API_BASE_URL: process.env.SENTRY_API_BASE_URL,
    SENTRY_DEFAULT_PROJECT: process.env.SENTRY_DEFAULT_PROJECT,
    DASHBOARD_ACCESS_SECRET: process.env.DASHBOARD_ACCESS_SECRET,
    ALLOW_UNAUTHENTICATED: process.env.ALLOW_UNAUTHENTICATED,
  })

  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const name = String(issue.path[0] ?? 'environment')
      return `  ${name} — ${requirements[name] ?? issue.message}`
    })
    throw new ConfigError(
      'The app is not configured. Required environment variables are missing or invalid.',
      `Missing or invalid environment variables:\n${problems.join('\n')}\n\nSet them in .env.local (see .env.example).`,
    )
  }

  resolved = parsed.data
  return resolved
}
