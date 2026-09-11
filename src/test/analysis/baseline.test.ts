import { describe, expect, it } from 'vitest'
import { formatMultiplier } from '@/lib/analysis/score'
import { NOW, WINDOW_START, analyze, snapshot } from './fixtures'

const MS_PER_HOUR = 3_600_000

describe('baseline windowing', () => {
  it('clamps the baseline to the age of the problem', () => {
    // Three days old, steady at 10 events/hour for its whole life. The configured baseline is six
    // days, so without a clamp the denominator covers time the issue did not exist.
    const steady = snapshot({
      firstSeen: NOW - 72 * MS_PER_HOUR,
      currentEvents: 240,
      baselineEvents: 480,
      userCount: 40,
    })

    const [problem] = analyze([steady])

    expect(problem.aggregate.baselineHours).toBe(48)
    expect(problem.aggregate.clampedBy).toBe('age')
    expect(problem.aggregate.baselineRate).toBeCloseTo(10, 6)
    expect(problem.aggregate.currentRate).toBeCloseTo(10, 6)
    expect(problem.aggregate.surgeMultiplier ?? 0).toBeCloseTo(1, 6)
    expect(problem.state).toBe('CHRONIC')
  })

  it('would have manufactured a surge without the clamp', () => {
    // The same events divided by the full six-day baseline instead of the two days the issue has
    // existed: 480/144 = 3.3/hour against 10/hour now, which crosses the 3x threshold.
    const eventsPerHourUnclamped = 480 / 144
    expect(10 / eventsPerHourUnclamped).toBeGreaterThanOrEqual(3)
  })

  it('gives no multiplier at all when the usable baseline is too short', () => {
    const barelyBorn = snapshot({
      firstSeen: WINDOW_START - 12 * MS_PER_HOUR,
      currentEvents: 500,
      baselineEvents: 20,
      userCount: 60,
    })

    const [problem] = analyze([barelyBorn])

    expect(problem.aggregate.hasBaseline).toBe(false)
    expect(problem.aggregate.surgeMultiplier).toBeNull()
    expect(problem.state).not.toBe('SURGING')
    expect(formatMultiplier(problem.aggregate.surgeMultiplier)).toBe('—')
  })

  it('reports no multiplier when nothing happened in the window', () => {
    const silent = snapshot({ currentEvents: 0, baselineEvents: 1_440, userCount: 0 })
    const [problem] = analyze([silent])

    expect(problem.aggregate.currentEvents).toBe(0)
    expect(problem.aggregate.surgeMultiplier).toBeNull()
  })

  it('says what period it actually compared against', () => {
    const surging = snapshot({
      firstSeen: NOW - 96 * MS_PER_HOUR,
      currentEvents: 720,
      baselineEvents: 72,
      userCount: 90,
    })

    const [problem] = analyze([surging])

    expect(problem.state).toBe('SURGING')
    expect(problem.reason).toContain('since it first appeared')
  })
})

describe('rate formatting', () => {
  it('renders a dash rather than a fabricated ratio', () => {
    expect(formatMultiplier(null)).toBe('—')
  })

  it('renders a decrease as a fraction of normal, not a reciprocal', () => {
    expect(formatMultiplier(0.3)).toBe('0.3x')
    expect(formatMultiplier(1)).toBe('flat')
    expect(formatMultiplier(18.2)).toBe('18x')
  })
})

describe('chronic wording', () => {
  it('does not call a tenfold drop "steady"', () => {
    const collapsed = snapshot({
      firstSeen: NOW - 60 * 24 * MS_PER_HOUR,
      currentEvents: 24,
      baselineEvents: 1_440,
      userCount: 20,
    })

    const [problem] = analyze([collapsed])

    expect(problem.state).toBe('CHRONIC')
    expect(problem.reason).not.toContain('steady')
    expect(problem.reason).toContain('down to')
  })

  it('still calls a flat rate steady', () => {
    const flat = snapshot({
      firstSeen: NOW - 60 * 24 * MS_PER_HOUR,
      currentEvents: 240,
      baselineEvents: 1_440,
      userCount: 20,
    })

    expect(analyze([flat])[0].reason).toContain('steady')
  })
})
