import { describe, expect, it } from 'vitest'
import { assertServerSafety, unauthenticatedProduction } from '@/lib/config/guard'

function withEnv(env: Record<string, string | undefined>, run: () => void) {
  const saved = { ...process.env }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    run()
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  }
}

const PROD_NO_GATE = {
  NODE_ENV: 'production',
  DASHBOARD_ACCESS_SECRET: undefined,
  ALLOW_UNAUTHENTICATED: undefined,
}

describe('startup guard', () => {
  it('refuses to start unauthenticated in production', () => {
    // This app holds a token that can read the whole org's errors and has no user system.
    withEnv(PROD_NO_GATE, () => expect(() => assertServerSafety()).toThrow(/Refusing to start/))
  })

  it('starts when a shared secret gates it', () => {
    withEnv({ NODE_ENV: 'production', DASHBOARD_ACCESS_SECRET: 'a-sufficiently-long-secret' }, () =>
      expect(() => assertServerSafety()).not.toThrow(),
    )
  })

  it('starts when the operator explicitly opts out, and says so', () => {
    withEnv({ ...PROD_NO_GATE, ALLOW_UNAUTHENTICATED: 'true' }, () => {
      expect(() => assertServerSafety()).not.toThrow()
      expect(unauthenticatedProduction()).toBe(true)
    })
  })

  it('refuses when a credential is exposed to the browser bundle', () => {
    // NEXT_PUBLIC_* is inlined into client JavaScript.
    withEnv({ NODE_ENV: 'development', NEXT_PUBLIC_SENTRY_TOKEN: 'x' }, () =>
      expect(() => assertServerSafety()).toThrow(/exposed to the browser bundle/),
    )
  })

  it('allows a NEXT_PUBLIC variable that is not a credential', () => {
    withEnv({ NODE_ENV: 'development', NEXT_PUBLIC_APP_NAME: 'triage' }, () =>
      expect(() => assertServerSafety()).not.toThrow(),
    )
  })

  it('does not gate development', () => {
    withEnv({ NODE_ENV: 'development', DASHBOARD_ACCESS_SECRET: undefined }, () => {
      expect(() => assertServerSafety()).not.toThrow()
      expect(unauthenticatedProduction()).toBe(false)
    })
  })
})
