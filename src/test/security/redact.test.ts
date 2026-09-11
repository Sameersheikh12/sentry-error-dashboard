import { afterEach, describe, expect, it } from 'vitest'
import { redact } from '@/lib/sentry/redact'

const TOKEN = 'sntryu_abcdef0123456789abcdef0123456789abcdef01'

afterEach(() => {
  delete process.env.SENTRY_AUTH_TOKEN
})

describe('redact', () => {
  it('removes a configured token wherever it appears in a string', () => {
    process.env.SENTRY_AUTH_TOKEN = TOKEN
    expect(redact(`request failed with ${TOKEN} attached`)).not.toContain(TOKEN)
  })

  it('removes it from nested objects and arrays', () => {
    process.env.SENTRY_AUTH_TOKEN = TOKEN
    const scrubbed = JSON.stringify(
      redact({ a: [{ note: `used ${TOKEN}` }], b: { c: TOKEN } }),
    )
    expect(scrubbed).not.toContain(TOKEN)
  })

  it('drops values under credential-shaped keys entirely', () => {
    const scrubbed = redact({ Authorization: 'Bearer abc123456789', safe: 'keep me' })
    expect(scrubbed.Authorization).toBe('[redacted]')
    expect(scrubbed.safe).toBe('keep me')
  })

  it('catches Sentry token shapes even when the env was never set', () => {
    expect(redact('Authorization: Bearer sntrys_someorgtokenvalue000000')).not.toMatch(/sntry[a-z]_/)
    expect(redact('token sntryu_anotheruservalue00000000')).not.toMatch(/sntry[a-z]_/)
  })

  it('never partially masks — a prefix of a live token is still disclosure', () => {
    process.env.SENTRY_AUTH_TOKEN = TOKEN
    const scrubbed = redact(`x ${TOKEN} y`)
    expect(scrubbed).not.toContain(TOKEN.slice(0, 16))
  })

  it('leaves ordinary values untouched', () => {
    expect(redact('fetched 400 issues in 120ms')).toBe('fetched 400 issues in 120ms')
    expect(redact(42)).toBe(42)
    expect(redact(null)).toBe(null)
  })
})
