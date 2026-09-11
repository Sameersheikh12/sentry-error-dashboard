import { describe, expect, it } from 'vitest'
import { NOW, analyze, snapshot, withHistory } from './fixtures'

const journeyIssue = (id: string, apiPath: string, culprit: string) =>
  snapshot({
    id,
    title: `PWA Journey API Error: API exception at ${apiPath}`,
    exceptionType: 'PWA Journey API Error',
    culprit,
    currentEvents: 60,
    baselineEvents: 60,
    userCount: 5,
  })

describe('grouping signature', () => {
  it('splits two API paths that share a culprit', () => {
    const problems = analyze([
      journeyIssue('1', '/journey/fetch-user-info', '/j/outstanding-to-emi:landing'),
      journeyIssue('2', '/journey/capture-event', '/j/outstanding-to-emi:landing'),
    ])

    expect(problems).toHaveLength(2)
    expect(problems.map((problem) => problem.key).sort()).toEqual([
      '/journey/capture-event',
      '/journey/fetch-user-info',
    ])
    expect(problems.every((problem) => problem.extractor === 'api-path')).toBe(true)
  })

  it('merges one API path across id-bearing variants', () => {
    const problems = analyze([
      journeyIssue('1', '/journey/accounts/8f2c41ab9d40/emi', '/j/a'),
      journeyIssue('2', '/journey/accounts/93f10c22a71b/emi', '/j/b'),
      journeyIssue('3', '/journey/accounts/550e8400-e29b-41d4-a716-446655440000/emi', '/j/c'),
    ])

    expect(problems).toHaveLength(1)
    expect(problems[0].key).toBe('/journey/accounts/:id/emi')
    expect(problems[0].issues).toHaveLength(3)
  })

  it('never groups on a generic wrapper prefix alone', () => {
    // No API path in the title, so the wrapper type must be skipped and the culprit used.
    const problems = analyze([
      snapshot({
        id: '1',
        title: 'PWA Journey API Error: request failed',
        exceptionType: 'PWA Journey API Error',
        culprit: '/j/transaction-to-emi',
        currentEvents: 10,
      }),
    ])

    expect(problems[0].key).not.toBe('PWA Journey API Error')
    expect(problems[0].key).toBe('/j/transaction-to-emi')
    expect(problems[0].extractor).toBe('normalized-culprit')
  })

  it('still groups on a specific exception type', () => {
    const problems = analyze([
      snapshot({
        id: '1',
        title: 'ChunkLoadError: Loading chunk 42 failed',
        exceptionType: 'ChunkLoadError',
        culprit: '/a',
        currentEvents: 10,
      }),
      snapshot({
        id: '2',
        title: 'ChunkLoadError: Loading chunk 77 failed',
        exceptionType: 'ChunkLoadError',
        culprit: '/b',
        currentEvents: 10,
      }),
    ])

    expect(problems).toHaveLength(1)
    expect(problems[0].extractor).toBe('exception-type')
  })

  it('merges a route and its steps so one journey reads as one problem', () => {
    const problems = analyze([
      snapshot({ id: '1', title: 'boom', exceptionType: null, culprit: '/j/transaction-to-emi', currentEvents: 10 }),
      snapshot({ id: '2', title: 'boom', exceptionType: null, culprit: '/j/transaction-to-emi:landing', currentEvents: 10 }),
    ])

    expect(problems).toHaveLength(1)
    expect(problems[0].key).toBe('/j/transaction-to-emi')
  })

  it("gives one problem per issue when grouping is 'none'", () => {
    const issues = [1, 2, 3].map((n) =>
      journeyIssue(String(n), '/journey/fetch-user-info', '/j/same'),
    )

    expect(analyze(issues, { groupingDimension: 'none' })).toHaveLength(3)
    expect(analyze(issues)).toHaveLength(1)
  })

  it('flags a cluster whose members share nothing but the key and the wrapper boilerplate', () => {
    const loose = analyze([
      snapshot({ id: '1', title: 'PWA Journey API Error: alpha bravo', exceptionType: null, culprit: '/j/x', currentEvents: 5 }),
      snapshot({ id: '2', title: 'PWA Journey API Error: charlie delta', exceptionType: null, culprit: '/j/x', currentEvents: 5 }),
    ])
    expect(loose[0].looseGrouping).toBe(true)

    const tight = analyze([
      snapshot({ id: '1', title: 'Timeout contacting billing service', exceptionType: null, culprit: '/j/y', currentEvents: 5 }),
      snapshot({ id: '2', title: 'Timeout contacting billing gateway', exceptionType: null, culprit: '/j/y', currentEvents: 5 }),
    ])
    expect(tight[0].looseGrouping).toBe(false)
  })

  it('does not promote a mature problem to NEW because one member is new', () => {
    const problems = analyze([
      withHistory({
        baselinePerDay: 200,
        currentEvents: 200,
        overrides: { id: 'c1', title: 'x', exceptionType: null, culprit: '/j/z', userCount: 5 },
      }),
      snapshot({
        id: 'n1',
        title: 'x',
        exceptionType: null,
        culprit: '/j/z',
        currentEvents: 12,
        userCount: 3,
        firstSeen: NOW - 20 * 60_000,
      }),
    ])

    expect(problems).toHaveLength(1)
    expect(problems[0].state).not.toBe('NEW')
    // The new member is still surfaced, as a marker rather than a promotion.
    expect(problems[0].hasNewVariant).toBe(true)
  })
})
