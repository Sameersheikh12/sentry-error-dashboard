import { describe, expect, it } from 'vitest'
import { NOW, analyze, snapshot, spread, withHistory } from './fixtures'

const MS_PER_HOUR = 3_600_000
const stateOf = (issue: Parameters<typeof analyze>[0][number]) => analyze([issue])[0].state

describe('classifyState', () => {
  it('calls a problem first seen inside the window NEW', () => {
    expect(stateOf(snapshot({ firstSeen: NOW - 40 * 60_000, currentEvents: 90 }))).toBe('NEW')
  })

  it('does not call it NEW when it predates the window', () => {
    expect(
      stateOf(snapshot({ firstSeen: NOW - 25 * MS_PER_HOUR, currentEvents: 90 })),
    ).not.toBe('NEW')
  })

  it('does not surge on a 1-to-4 event jump — a 4x rise of nothing is still nothing', () => {
    expect(stateOf(withHistory({ baselinePerDay: 1, currentEvents: 4 }))).toBe('CHRONIC')
  })

  it('surges on a 5-to-400 event jump', () => {
    expect(stateOf(withHistory({ baselinePerDay: 5, currentEvents: 400 }))).toBe('SURGING')
  })

  it('treats a steady problem as CHRONIC', () => {
    expect(stateOf(withHistory({ baselinePerDay: 240, currentEvents: 240 }))).toBe('CHRONIC')
  })

  it('treats a problem that has stopped as FADING', () => {
    const stopped = withHistory({
      baselinePerDay: 240,
      currentEvents: 0,
      overrides: { buckets: spread(0) },
    })
    expect(stateOf(stopped)).toBe('FADING')
  })

  it('does not call a rare issue FADING just because the window was quiet', () => {
    expect(stateOf(snapshot({ currentEvents: 0, baselineEvents: 2 }))).toBe('CHRONIC')
  })

  it('trusts Sentry substatus for regressions', () => {
    const regressed = withHistory({
      baselinePerDay: 10,
      currentEvents: 20,
      overrides: { substatus: 'regressed' },
    })
    expect(stateOf(regressed)).toBe('REGRESSED')
  })

  it('calls a resolved issue that is still firing REGRESSED', () => {
    const resolved = withHistory({
      baselinePerDay: 10,
      currentEvents: 20,
      overrides: { status: 'resolved', substatus: null },
    })
    expect(stateOf(resolved)).toBe('REGRESSED')
  })
})

describe('ranking', () => {
  it('puts a new low-volume problem above a chronic high-volume one', () => {
    const newcomer = snapshot({
      id: 'new',
      culprit: '/api/payments/authorize',
      title: 'PaymentTimeout',
      exceptionType: 'PaymentTimeout',
      firstSeen: NOW - 40 * 60_000,
      currentEvents: 50,
      userCount: 40,
    })
    const chronic = withHistory({
      baselinePerDay: 14_286,
      currentEvents: 14_286,
      overrides: {
        id: 'chronic',
        culprit: '/api/search/query',
        title: 'SearchError',
        exceptionType: 'SearchError',
        userCount: 5,
      },
    })

    expect(analyze([chronic, newcomer]).map((p) => p.issues[0].snapshot.id)).toEqual([
      'new',
      'chronic',
    ])
  })
})

describe('zero-baseline problems', () => {
  it('surges rather than being described as steady when the baseline was silent', () => {
    const silentThenLoud = snapshot({ currentEvents: 117, baselineEvents: 0, userCount: 106 })
    const [problem] = analyze([silentThenLoud])

    expect(problem.state).toBe('SURGING')
    expect(problem.reason).toContain('x its normal rate')
    expect(problem.reason).not.toContain('steady')
  })

  it('still ignores a zero baseline below the event floor', () => {
    expect(stateOf(snapshot({ currentEvents: 4, baselineEvents: 0 }))).toBe('CHRONIC')
  })
})
