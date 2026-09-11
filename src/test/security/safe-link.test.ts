import { describe, expect, it } from 'vitest'
import { clampText, safeSentryLink } from '@/lib/dashboard/safe-link'

const SENTRY = 'https://sentry.io'

describe('safeSentryLink', () => {
  it('accepts a permalink on the configured host', () => {
    expect(safeSentryLink('https://sentry.io/organizations/acme/issues/1/', SENTRY)).toBe(
      'https://sentry.io/organizations/acme/issues/1/',
    )
  })

  it('accepts the org subdomain Sentry actually serves permalinks from', () => {
    expect(safeSentryLink('https://acme.sentry.io/issues/1/', SENTRY)).not.toBeNull()
  })

  it('refuses a javascript: URL', () => {
    // Issue fields are arbitrary text from production errors; this must never become a link.
    expect(safeSentryLink('javascript:alert(document.cookie)', SENTRY)).toBeNull()
  })

  it('refuses another host, however similar', () => {
    expect(safeSentryLink('https://evil.com/issues/1/', SENTRY)).toBeNull()
    expect(safeSentryLink('https://sentry.io.evil.com/issues/1/', SENTRY)).toBeNull()
  })

  it('refuses plain http', () => {
    expect(safeSentryLink('http://sentry.io/issues/1/', SENTRY)).toBeNull()
  })

  it('refuses malformed input instead of throwing', () => {
    expect(safeSentryLink('not a url', SENTRY)).toBeNull()
    expect(safeSentryLink('', SENTRY)).toBeNull()
  })

  it('honours a self-hosted base URL', () => {
    const self = 'https://sentry.internal.example.com'
    expect(safeSentryLink('https://sentry.internal.example.com/issues/1/', self)).not.toBeNull()
    expect(safeSentryLink('https://sentry.io/issues/1/', self)).toBeNull()
  })
})

describe('clampText', () => {
  it('caps a pathological title so it cannot break the layout', () => {
    expect(clampText('x'.repeat(500), 40)).toHaveLength(40)
  })

  it('leaves short text alone', () => {
    expect(clampText('short', 40)).toBe('short')
  })
})
