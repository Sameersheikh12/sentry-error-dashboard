export type IssueState = 'NEW' | 'REGRESSED' | 'SURGING' | 'CHRONIC' | 'FADING'

/** Where a problem's grouping key came from. Shown in the UI so a merge can be judged. */
export type GroupingExtractor = 'api-path' | 'exception-type' | 'normalized-culprit' | 'issue-id'

export type GroupingDimension = 'signature' | 'none'

/** A zeroed tally, so the three places that count states cannot drift in their key set. */
export function emptyStateCounts(): Record<IssueState, number> {
  return { NEW: 0, REGRESSED: 0, SURGING: 0, CHRONIC: 0, FADING: 0 }
}

/** Most alarming first. The one ordering used for filter pills, chart stacking and severity. */
export const STATE_SEVERITY: readonly IssueState[] = [
  'NEW',
  'REGRESSED',
  'SURGING',
  'CHRONIC',
  'FADING',
]

/**
 * States that are, by definition, not news. They are collapsed on the dashboard rather than
 * dropped — the whole point is that nothing is hidden, only ordered.
 */
export const BACKGROUND_STATES: readonly IssueState[] = ['CHRONIC', 'FADING']

/** [epoch ms, events in that bucket]. Interval is whatever Sentry chose for the window. */
export interface StatsPoint {
  timestamp: number
  events: number
}

/**
 * An issue as the analysis layer sees it. Current and baseline counts arrive already separated,
 * each scoped by Sentry to its own date range, so nothing downstream subtracts one from the other.
 */
export interface IssueSnapshot {
  id: string
  shortId: string
  title: string
  culprit: string | null
  permalink: string
  exceptionType: string | null
  level: string | null
  status: string
  substatus: string | null
  firstSeen: number
  lastSeen: number
  currentEvents: number
  baselineEvents: number
  /**
   * Users inside the current window only. An issue seen solely in the baseline contributes zero,
   * or its baseline-period users would surface as the problem's headline figure.
   */
  userCount: number
  buckets: StatsPoint[]
}

/**
 * Every figure the UI shows for a problem, computed once. A single issue is an aggregate of one,
 * so an issue row and a problem row can never disagree about what they are describing.
 */
export type BaselineClamp = 'none' | 'age' | 'retention'

export interface ProblemAggregate {
  currentEvents: number
  baselineEvents: number
  /** Events per hour inside the current window. */
  currentRate: number
  /** Events per hour across the baseline period actually available. */
  baselineRate: number
  /** Hours actually compared against, after clamping to the problem's age and to retention. */
  baselineHours: number
  /** Instant the comparison period began. */
  baselineStart: number
  /** False when the available baseline is too short to divide by. */
  hasBaseline: boolean
  /** Why the baseline is shorter than configured, so the UI can say what it compared against. */
  clampedBy: BaselineClamp
  /** Null when there is no usable baseline. Never render a number in that case. */
  surgeMultiplier: number | null
  /**
   * The largest per-issue user count in the group. Sentry cannot de-duplicate users across
   * issues, so a sum would double-count anyone hit by two of them. This understates and is
   * presented as a floor — "at least N" — which is the right bias for a number people act on.
   */
  userCount: number
  firstSeen: number
  lastSeen: number
}

export interface AnalyzedIssue {
  snapshot: IssueSnapshot
  aggregate: ProblemAggregate
  state: IssueState
  score: number
  reason: string
}

export interface Problem {
  key: string
  /** A mature problem that gained a member inside the window — a signal, not a state promotion. */
  hasNewVariant: boolean
  /** Below the event or user floor: counted, ranked separately, never deleted. */
  belowThreshold: boolean
  /** Which extractor produced the key. Surfaced so "is the grouping good?" is answerable. */
  extractor: GroupingExtractor
  state: IssueState
  score: number
  reason: string
  aggregate: ProblemAggregate
  buckets: StatsPoint[]
  /** Member titles share no significant token beyond the key — the merge may be wrong. */
  looseGrouping: boolean
  issues: AnalyzedIssue[]
}
