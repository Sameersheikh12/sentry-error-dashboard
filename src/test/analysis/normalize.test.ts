import { describe, expect, it } from 'vitest'
import { normalizeCulprit } from '@/lib/analysis/normalize'

describe('normalizeCulprit', () => {
  it('collapses the same endpoint hit with different ids into one key', () => {
    const normalized = [
      '/api/accounts/8f2c-41ab/emi',
      '/api/accounts/93f1-0c22/emi',
      '/api/accounts/a71b-9d40/emi',
    ].map(normalizeCulprit)

    expect(new Set(normalized)).toEqual(new Set(['/api/accounts/:id/emi']))
  })

  it('replaces uuids, digit runs and emails', () => {
    expect(normalizeCulprit('/orders/550e8400-e29b-41d4-a716-446655440000/items')).toBe(
      '/orders/:id/items',
    )
    expect(normalizeCulprit('/users/12345/profile')).toBe('/users/:id/profile')
    expect(normalizeCulprit('/users/sameer@hyperface.co/settings')).toBe('/users/:email/settings')
    expect(normalizeCulprit('/assets/9f86d081884c7d65/bundle.js')).toBe('/assets/:id/bundle.js')
  })

  it('keeps genuinely different endpoints apart', () => {
    expect(normalizeCulprit('/api/accounts/8f2c-41ab/emi')).not.toBe(
      normalizeCulprit('/api/orders/8f2c-41ab/emi'),
    )
    expect(normalizeCulprit('/api/accounts/8f2c-41ab/emi')).not.toBe(
      normalizeCulprit('/api/accounts/8f2c-41ab/statement'),
    )
  })

  it('leaves static segments alone, including version markers and hex-looking words', () => {
    expect(normalizeCulprit('/api/v2/accounts/summary')).toBe('/api/v2/accounts/summary')
    expect(normalizeCulprit('/content/deadbeef/index')).toBe('/content/deadbeef/index')
  })

  it('preserves an HTTP method prefix on transaction names', () => {
    expect(normalizeCulprit('GET /api/accounts/8f2c-41ab/emi')).toBe('GET /api/accounts/:id/emi')
  })

  it('normalises away query strings and trailing slashes', () => {
    expect(normalizeCulprit('/api/accounts/12/emi/?cursor=abc')).toBe('/api/accounts/:id/emi')
  })

  it('returns null when there is no culprit to group on', () => {
    expect(normalizeCulprit(null)).toBeNull()
    expect(normalizeCulprit('   ')).toBeNull()
  })

  it('leaves dotted module culprits as they are', () => {
    expect(normalizeCulprit('app.views.checkout')).toBe('app.views.checkout')
  })
})

describe('normalizeCulprit on non-path culprits', () => {
  it('keeps anonymous frame culprits intact instead of splitting on the question mark', () => {
    expect(normalizeCulprit('?(main)')).toBe('?(main)')
    expect(normalizeCulprit('v.onerror(main)')).toBe('v.onerror(main)')
  })

  it('never returns an empty key, which would merge unrelated issues under a blank label', () => {
    for (const culprit of ['?', '#', '?(main)', '   ', null]) {
      const key = normalizeCulprit(culprit)
      expect(key === null || key.trim().length > 0).toBe(true)
    }
  })
})

describe('normalizeCulprit on Sentry JS frame culprits', () => {
  it('collapses ids inside a wrapped frame name so those issues still cluster', () => {
    expect(normalizeCulprit('?(8e068bb67c90/07a78f6404f1/launch)')).toBe('?(:id/:id/launch)')
    expect(normalizeCulprit('?(8e068bb67c90/07a78f6404f1/launch)')).toBe(
      normalizeCulprit('?(1a2b3c4d5e6f/9f8e7d6c5b4a/launch)'),
    )
  })

  it('collapses a content hash embedded in a filename', () => {
    expect(normalizeCulprit('/static/bundle.4f1a09cd.js')).toBe('/static/bundle.:id.js')
  })

  it('still strips a real query string once a path has started', () => {
    expect(normalizeCulprit('/api/accounts/12/emi?cursor=abc')).toBe('/api/accounts/:id/emi')
  })

  it('leaves a frame name with no identifier alone', () => {
    expect(normalizeCulprit('?(main)')).toBe('?(main)')
    expect(normalizeCulprit('v.onerror(main)')).toBe('v.onerror(main)')
  })
})
