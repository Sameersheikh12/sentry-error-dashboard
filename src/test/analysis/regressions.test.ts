import { describe, expect, it } from 'vitest'
import { normalizeCulprit, scrubTitle } from '@/lib/analysis/normalize'
import { NOW, analyze, analyzeFull, snapshot, withHistory } from './fixtures'

describe('FADING reaches the reader', () => {
  it('is not filed below the signal threshold', () => {
    // FADING means zero events in the window by definition, so an event/user floor applied to it
    // would reject every one — which is how 11 real stopped problems ended up filed as
    // "too few events or users to act on".
    const stopped = withHistory({
      baselinePerDay: 240,
      currentEvents: 0,
      overrides: { userCount: 0 },
    })

    const [problem] = analyze([stopped])

    expect(problem.state).toBe('FADING')
    expect(problem.belowThreshold).toBe(false)
  })

  it('still holds a trivial problem below the threshold', () => {
    const trivial = snapshot({ currentEvents: 1, userCount: 1 })
    expect(analyze([trivial])[0].belowThreshold).toBe(true)
  })
})

describe('identifier scrubbing', () => {
  it('collapses prefixed ids whose prefix itself contains an underscore', () => {
    expect(scrubTitle('failed for acc_ca_HYPmFOnLGHIID570ovj')).toBe('failed for :id')
    expect(normalizeCulprit('/journey/accounts/acc_ca_HYPmFOnLGHIID570ovj/emi')).toBe(
      '/journey/accounts/:id/emi',
    )
  })

  it('merges the same endpoint across different account ids', () => {
    const keys = ['acc_ca_HYP7ZJfGvoUmLEhb1Gr', 'acc_ca_HYPuuztlIIG3q7tXRaH'].map((id) =>
      normalizeCulprit(`/journey/accounts/${id}`),
    )

    expect(new Set(keys).size).toBe(1)
  })

  it('leaves ordinary snake_case endpoints alone', () => {
    // These are words, not identifiers; collapsing them would merge unrelated endpoints.
    for (const path of ['/api/user_preferences', '/api/checkout_session', '/api/payment_gateway']) {
      expect(normalizeCulprit(path)).toBe(path)
    }
  })
})

describe('reason strings', () => {
  it('never attributes the headline state to zero members', () => {
    // A group's aggregate can surge while no single member does, which used to read "0 of N issues".
    const members = [0, 1, 2].map((index) =>
      snapshot({
        id: String(index),
        culprit: '/api/checkout',
        exceptionType: null,
        title: 'checkout failed',
        currentEvents: 60,
        baselineEvents: 2,
        userCount: 20,
      }),
    )

    for (const problem of analyze(members)) {
      expect(problem.reason).not.toMatch(/\b0 of \d+ issues/)
    }
  })
})

describe('regression attribution', () => {
  it('does not relabel a busy cluster because one silent member is resolved', () => {
    const active = snapshot({
      id: 'active',
      culprit: '/api/pay',
      exceptionType: null,
      title: 'pay failed',
      currentEvents: 400,
      baselineEvents: 400,
      userCount: 50,
    })
    const silentResolved = snapshot({
      id: 'closed',
      culprit: '/api/pay',
      exceptionType: null,
      title: 'pay failed',
      status: 'resolved',
      currentEvents: 0,
      baselineEvents: 100,
      userCount: 0,
    })

    const [problem] = analyzeFull([active, silentResolved]).problems
    expect(problem.issues).toHaveLength(2)
    expect(problem.state).not.toBe('REGRESSED')
  })

  it('still reports a resolved issue that is firing again', () => {
    const firingAgain = snapshot({
      id: 'back',
      currentEvents: 300,
      baselineEvents: 300,
      userCount: 40,
      status: 'resolved',
    })

    expect(analyze([firingAgain])[0].state).toBe('REGRESSED')
  })
})

describe('grouping keys discriminate', () => {
  it('refuses a key made only of placeholders', () => {
    const issues = [
      { path: '/12345', culprit: '/checkout/review' },
      { path: '/98765', culprit: '/onboarding/verify' },
    ].map((entry, index) =>
      snapshot({
        id: String(index),
        title: `API exception at ${entry.path}`,
        exceptionType: null,
        culprit: entry.culprit,
        currentEvents: 40,
        userCount: 10,
      }),
    )

    const problems = analyze(issues)
    // The all-placeholder path is rejected, so each falls through to its own culprit.
    expect(problems.every((problem) => problem.key !== '/:id')).toBe(true)
    expect(problems).toHaveLength(2)
  })
})
