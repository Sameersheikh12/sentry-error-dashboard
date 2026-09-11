import type { IssueState, ProblemAggregate } from './types'

export interface ClassifyOptions {
  windowStart: number
  windowHours: number
  surgeMultiplier: number
  minEventFloor: number
  fadeThreshold: number
}

/** The membership facts a rate cannot tell you. */
export interface ClassifyFacts {
  status: string
  substatus: string | null
}

/**
 * Note there is no firstSeen parameter: NEW is decided by the aggregate's earliest firstSeen, so
 * a problem cannot be called new because one of thirty-two members is new. A mature problem that
 * grows a variant is still a mature problem.
 */
export function classifyState(
  facts: ClassifyFacts,
  aggregate: ProblemAggregate,
  options: ClassifyOptions,
): IssueState {
  if (aggregate.firstSeen >= options.windowStart) return 'NEW'

  if (isRegressed(facts, aggregate)) return 'REGRESSED'
  if (isSurging(aggregate, options)) return 'SURGING'
  if (isFading(aggregate, options)) return 'FADING'

  return 'CHRONIC'
}

function isRegressed(facts: ClassifyFacts, aggregate: ProblemAggregate): boolean {
  if (facts.substatus === 'regressed') return true
  // A resolved issue still producing events has regressed, whether or not Sentry relabelled it.
  return facts.status === 'resolved' && aggregate.currentEvents > 0
}

function isSurging(aggregate: ProblemAggregate, options: ClassifyOptions): boolean {
  if (aggregate.surgeMultiplier === null) return false
  if (aggregate.currentEvents < options.minEventFloor) return false
  return aggregate.surgeMultiplier >= options.surgeMultiplier
}

/**
 * Silence only means something if the baseline predicted otherwise. An issue that fired twice in
 * a fortnight is not "fixed" because the window was quiet.
 */
function isFading(aggregate: ProblemAggregate, options: ClassifyOptions): boolean {
  if (!aggregate.hasBaseline) return false
  if (aggregate.currentEvents > options.fadeThreshold) return false
  return aggregate.baselineRate * options.windowHours >= options.minEventFloor
}
