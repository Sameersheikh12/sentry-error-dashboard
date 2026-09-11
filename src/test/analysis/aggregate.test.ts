import { describe, expect, it } from 'vitest'
import { formatMultiplier, formatRate, formatUsers } from '@/lib/analysis/score'
import { BASELINE_HOURS, WINDOW_HOURS, analyze, snapshot } from './fixtures'

/**
 * The reason string and the figures beside it are the same numbers or the page is lying. This
 * class of bug is invisible at a glance, which is why it is pinned here.
 */
describe('problem aggregate', () => {
  const problem = () =>
    analyze([
      snapshot({
        id: 'a',
        title: 'API exception at /journey/transaction-to-emi',
        currentEvents: 1_800,
        baselineEvents: 600,
        userCount: 171,
      }),
      snapshot({
        id: 'b',
        title: 'API exception at /journey/transaction-to-emi',
        currentEvents: 96,
        baselineEvents: 24,
        userCount: 90,
      }),
    ])[0]

  it('sums member events and derives rates from the group, not a representative issue', () => {
    const { aggregate } = problem()

    expect(aggregate.currentEvents).toBe(1_896)
    expect(aggregate.baselineEvents).toBe(624)
    expect(aggregate.currentRate).toBeCloseTo(1_896 / WINDOW_HOURS, 6)
    expect(aggregate.baselineRate).toBeCloseTo(624 / BASELINE_HOURS, 6)
  })

  it('matches a hand-computed multiplier', () => {
    // 1896 events / 24h = 79/hour against 624 / 144h = 4.33/hour, which is 18.2x.
    expect(problem().aggregate.surgeMultiplier ?? 0).toBeCloseTo(79 / (624 / BASELINE_HOURS), 4)
    expect(Math.round(problem().aggregate.surgeMultiplier ?? 0)).toBe(18)
  })

  it('states the aggregate rate and multiplier in the reason string', () => {
    const { reason, aggregate } = problem()

    expect(reason).toContain(`${formatMultiplier(aggregate.surgeMultiplier)} its normal rate`)
    expect(reason).toContain(formatRate(aggregate.currentRate))
    expect(reason).toContain(formatRate(aggregate.baselineRate))
  })

  it('reports users as a floor, and never sums them across issues', () => {
    const { reason, aggregate } = problem()

    expect(aggregate.userCount).toBe(171)
    expect(reason).toContain(formatUsers(171, true))
    expect(reason).toContain('at least 171 users')
    expect(reason).not.toContain('271')
  })

  it('gives a single issue the same aggregate as a one-member problem', () => {
    const single = analyze([snapshot({ currentEvents: 240, baselineEvents: 144, userCount: 9 })])[0]

    expect(single.issues[0].aggregate).toEqual(single.aggregate)
    expect(single.issues[0].reason).toBe(single.reason)
  })
})
