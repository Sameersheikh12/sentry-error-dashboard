import type { IssueState, ProblemAggregate } from './types'

const MS_PER_HOUR = 3_600_000
const MS_PER_MINUTE = 60_000
const HOURS_PER_DAY = 24

export interface ScoreOptions {
  now: number
  windowHours: number
  stateWeight: Record<IssueState, number>
  weights: {
    impact: number
    volume: number
    velocity: number
    recency: number
  }
  /** Ratio at which velocity saturates, so one absurd multiplier cannot dominate the ranking. */
  velocityCeiling: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 1 for the last hour, then straight down to 0 at the far edge of the window. */
function recencyScore(lastSeen: number, options: ScoreOptions): number {
  const ageHours = (options.now - lastSeen) / MS_PER_HOUR
  if (ageHours <= 1) return 1

  const decayHours = options.windowHours - 1
  if (decayHours <= 0) return 0
  return clamp(1 - (ageHours - 1) / decayHours, 0, 1)
}

export function scoreProblem(
  state: IssueState,
  aggregate: ProblemAggregate,
  options: ScoreOptions,
): number {
  // Both counts are logged so an issue with a hundred times the volume of another ranks about
  // twice as high, not a hundred times, which is closer to how much more it actually matters.
  const impact = Math.log10(1 + aggregate.userCount)
  const volume = Math.log10(1 + aggregate.currentEvents)
  // No usable baseline contributes no velocity rather than an invented one.
  const velocity =
    aggregate.surgeMultiplier === null
      ? 0
      : clamp(aggregate.surgeMultiplier, 0, options.velocityCeiling) / options.velocityCeiling
  const recency = recencyScore(aggregate.lastSeen, options)

  return (
    options.stateWeight[state] *
    (options.weights.impact * impact +
      options.weights.volume * volume +
      options.weights.velocity * velocity +
      options.weights.recency * recency)
  )
}

function formatAge(ageMs: number): string {
  const minutes = Math.round(ageMs / MS_PER_MINUTE)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.round(ageMs / MS_PER_HOUR)
  if (hours < HOURS_PER_DAY) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.round(hours / HOURS_PER_DAY)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Null means there is nothing to divide by — a problem with no usable baseline, or one that
 * produced no events. Render the dash; never fabricate a ratio.
 */
export function formatMultiplier(multiplier: number | null): string {
  if (multiplier === null || !Number.isFinite(multiplier)) return '—'
  if (multiplier >= 10) return `${Math.round(multiplier)}x`
  if (multiplier >= 1.05) return `${multiplier.toFixed(1)}x`
  if (multiplier > 0.95) return 'flat'
  return `${multiplier.toFixed(1)}x`
}

/** A rate that fell is not something this dashboard acts on; it should read quietly. */
export function isRateDecrease(multiplier: number | null): boolean {
  return multiplier !== null && multiplier < 0.95
}

const HOURS_PER_DAY_SPAN = 24

/** What the baseline actually covered, so "vs previous N days" is never a false statement. */
export function describeBaselineSpan(aggregate: ProblemAggregate): string {
  const days = aggregate.baselineHours / HOURS_PER_DAY_SPAN
  const span = days >= 1 ? `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}` : `${Math.round(aggregate.baselineHours)}h`

  switch (aggregate.clampedBy) {
    case 'age':
      return `${span} since it first appeared`
    case 'retention':
      return `${span} Sentry still holds`
    default:
      return `previous ${span}`
  }
}

export function formatRate(eventsPerHour: number): string {
  if (eventsPerHour >= 1) return `${Math.round(eventsPerHour)}/hour`

  const perDay = eventsPerHour * HOURS_PER_DAY
  if (perDay >= 1) return `${Math.round(perDay)}/day`
  return 'less than 1/day'
}

/**
 * Sentry counts users per issue and cannot de-duplicate across them, so a group's user count is
 * a floor rather than a total. Saying "at least" understates but never lies, which is the right
 * bias for a number someone is about to act on.
 */
export function formatUsers(userCount: number, isGroup: boolean): string {
  const prefix = isGroup ? 'at least ' : ''
  return `${prefix}${userCount.toLocaleString('en-US')} user${userCount === 1 ? '' : 's'} affected`
}

export interface ExplainOptions {
  now: number
  memberCount: number
  /** How many members are in the state being reported. */
  stateMemberCount: number
  /** The surge threshold; its reciprocal is the symmetric bar for calling something a decrease. */
  surgeThreshold: number
}

/**
 * The reason a problem sits where it does, in words, derived entirely from its aggregate so it
 * can never describe different numbers from the ones displayed beside it.
 */
export function explainProblem(
  state: IssueState,
  aggregate: ProblemAggregate,
  options: ExplainOptions,
): string {
  const clauses: string[] = []

  switch (state) {
    case 'NEW':
      clauses.push(`new ${formatAge(options.now - aggregate.firstSeen)}`)
      break
    case 'REGRESSED':
      clauses.push('came back after being resolved')
      break
    case 'SURGING':
      clauses.push(
        `${formatMultiplier(aggregate.surgeMultiplier)} its normal rate`,
        `usually ${formatRate(aggregate.baselineRate)} over ${describeBaselineSpan(aggregate)}, now ${formatRate(aggregate.currentRate)}`,
      )
      break
    case 'FADING':
      clauses.push(
        `stopped — was running at ${formatRate(aggregate.baselineRate)} over ${describeBaselineSpan(aggregate)}`,
      )
      break
    case 'CHRONIC': {
      // A problem running at a tenth of its usual rate is not "steady". Nothing here is worth
      // acting on, but the words still have to match the number in the rate column.
      const quietBar = options.surgeThreshold > 0 ? 1 / options.surgeThreshold : 0
      const fell =
        aggregate.surgeMultiplier !== null && aggregate.surgeMultiplier <= quietBar
      clauses.push(
        fell
          ? `down to ${formatRate(aggregate.currentRate)} from ${formatRate(aggregate.baselineRate)}`
          : `steady at ${formatRate(aggregate.currentRate)}`,
      )
      break
    }
  }

  // Say so when the headline state comes from a minority of the group, rather than letting the
  // badge imply every member is behaving that way. A count of zero is possible — the group's
  // aggregate can be surging while no single member is — and "0 of 5 issues" reads as a bug.
  if (
    options.memberCount > 1 &&
    options.stateMemberCount > 0 &&
    options.stateMemberCount < options.memberCount
  ) {
    clauses.push(`${options.stateMemberCount} of ${options.memberCount} issues`)
  }

  if (state !== 'FADING' && aggregate.userCount > 0) {
    clauses.push(formatUsers(aggregate.userCount, options.memberCount > 1))
  }

  return clauses.join(', ')
}
