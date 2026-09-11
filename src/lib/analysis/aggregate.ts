import type { BaselineClamp, IssueSnapshot, ProblemAggregate } from './types'

const MS_PER_HOUR = 3_600_000

export interface AggregateOptions {
  windowStart: number
  windowHours: number
  /** Where the baseline query actually began, already clamped to Sentry's retention. */
  baselineQueryStart: number
  /** Where it would have begun with no retention limit — only used to explain the clamp. */
  intendedBaselineStart: number
  /** Below this many hours a baseline is too short to divide by. */
  minBaselineHours: number
  velocityEpsilon: number
}

/**
 * Rates sum cleanly across issues, so a group's rate is its members' events over the span the
 * group could actually have produced them in.
 *
 * That span is the whole point. Dividing a fortnight of events by 180 days of baseline invents a
 * tiny denominator and turns steady traffic into a surge, so the baseline starts no earlier than
 * the problem itself existed and no earlier than Sentry still holds events.
 */
export function aggregate(
  snapshots: IssueSnapshot[],
  options: AggregateOptions,
): ProblemAggregate {
  const currentEvents = snapshots.reduce((total, issue) => total + issue.currentEvents, 0)
  const baselineEvents = snapshots.reduce((total, issue) => total + issue.baselineEvents, 0)
  const firstSeen = Math.min(...snapshots.map((issue) => issue.firstSeen))
  const lastSeen = Math.max(...snapshots.map((issue) => issue.lastSeen))

  const baselineStart = Math.max(options.baselineQueryStart, firstSeen)
  const baselineHours = Math.max(0, (options.windowStart - baselineStart) / MS_PER_HOUR)
  const hasBaseline = baselineHours >= options.minBaselineHours

  let clampedBy: BaselineClamp = 'none'
  if (firstSeen > options.baselineQueryStart) clampedBy = 'age'
  else if (options.baselineQueryStart > options.intendedBaselineStart) clampedBy = 'retention'

  const currentRate = options.windowHours > 0 ? currentEvents / options.windowHours : 0
  const baselineRate = hasBaseline ? baselineEvents / baselineHours : 0

  return {
    currentEvents,
    baselineEvents,
    currentRate,
    baselineRate,
    baselineHours,
    baselineStart,
    hasBaseline,
    clampedBy,
    // Null, never a number. No usable baseline means no multiplier, and nothing happening in the
    // window means there is no rate change to report either.
    surgeMultiplier:
      hasBaseline && currentEvents > 0
        ? currentRate / Math.max(baselineRate, options.velocityEpsilon)
        : null,
    /**
     * Largest per-issue count, never a sum — Sentry cannot de-duplicate users across issues.
     * Window-scoped, so an issue silent in the window contributes nothing.
     */
    userCount: snapshots.reduce((most, issue) => Math.max(most, issue.userCount), 0),
    firstSeen,
    lastSeen,
  }
}
