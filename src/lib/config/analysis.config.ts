import type { GroupingDimension, GroupingExtractor, IssueState } from '@/lib/analysis/types'

export interface WindowPreset {
  token: string
  label: string
  hours: number
}

/**
 * Sentry picks the bucket interval itself for a custom range, landing on roughly 30 buckets
 * whatever the span — about 2 minutes at 1h, 12 minutes at 6h, hourly at 24h, 6 hours at 7d,
 * 12 hours at 14d and daily at 30d. Nothing here fabricates buckets to fill a shape.
 */
export const WINDOW_PRESETS: readonly WindowPreset[] = [
  { token: '1h', label: 'Last hour', hours: 1 },
  { token: '6h', label: 'Last 6 hours', hours: 6 },
  { token: '24h', label: 'Last 24 hours', hours: 24 },
  { token: '7d', label: 'Last 7 days', hours: 24 * 7 },
  { token: '14d', label: 'Last 14 days', hours: 24 * 14 },
  { token: '30d', label: 'Last 30 days', hours: 24 * 30 },
]

export interface AnalysisConfig {
  defaultWindowToken: string
  /** Baseline span as a multiple of the selected window, so multipliers hold at every window. */
  baselineMultiplier: number
  /** currentRate / baselineRate at or above this counts as SURGING. */
  surgeMultiplier: number
  /**
   * The number of events below which a change in rate carries no information. A surge needs this
   * many events in the window (1 -> 4 events is a 4x jump and means nothing), and a fade needs a
   * baseline that predicted this many. Without it the dashboard fills with meaningless state
   * changes, which is the exact noise problem this app exists to remove.
   */
  minEventFloor: number
  /** Events in the window at or below which a previously-active problem counts as FADING. */
  fadeThreshold: number
  /**
   * A problem below either floor is counted and kept, but not presented as worth acting on.
   * One user hitting something once is not a production problem, and a headline that promises
   * things worth looking at then delivers single-digit noise teaches people to distrust it.
   */
  minUserFloor: number
  /** A baseline shorter than this cannot be divided by; the problem gets no multiplier. */
  minBaselineHours: number
  /**
   * Sentry's event retention. Verified at 90 days for this organization: a one-day slice 90 days
   * back returns events, 91 days back returns none. A baseline reaching past this divides by a
   * period Sentry no longer holds data for.
   */
  retentionDays: number
  groupingDimension: GroupingDimension
  /** Tried in order; the first to yield a discriminating key wins. */
  groupingExtractors: readonly GroupingExtractor[]
  /**
   * Type names that describe nothing. Grouping on them produces a garbage bucket, so an
   * extractor yielding one of these falls through to the next extractor instead.
   */
  genericTypeNames: readonly string[]
  /**
   * Exception types that wrap many unrelated failures and so carry no discriminating signal.
   * Expect to extend this per project — that is why it is configuration and not code.
   */
  wrapperTypePrefixes: readonly string[]
  /** Multiplier applied to the weighted score, by state. */
  stateWeight: Record<IssueState, number>
  /**
   * userCount outranks eventCount deliberately: one broken retry loop can emit ten thousand
   * events from three users, and that matters less than four hundred users hitting a wall once.
   */
  weights: {
    impact: number
    volume: number
    velocity: number
    recency: number
  }
  velocityCeiling: number
  /** Stands in for a zero baseline so a brand-new problem yields a finite multiplier. */
  velocityEpsilon: number
  /**
   * Period-over-period movement below this, either way, is treated as noise and shown in neutral
   * text. It answers the same "is this a real change?" question as surgeMultiplier, one level up.
   */
  overviewDeltaSignificantPercent: number
  /** Problems drawn individually on the timeline; the rest pool into one quiet remainder. */
  timelineTopProblems: number
  /** Environment names preferred as the default, in order. Falls back to all environments. */
  environmentPreference: readonly string[]
  /** Server-side revalidation window, so repeated refreshes do not burn Sentry rate limits. */
  cacheSeconds: number
}

export const analysisConfig: AnalysisConfig = {
  defaultWindowToken: '24h',
  baselineMultiplier: 6,
  surgeMultiplier: 3,
  minEventFloor: 10,
  fadeThreshold: 0,
  minUserFloor: 2,
  minBaselineHours: 24,
  retentionDays: 90,
  groupingDimension: 'signature',
  groupingExtractors: ['api-path', 'exception-type', 'normalized-culprit', 'issue-id'],
  genericTypeNames: [
    'Error',
    'TypeError',
    'SyntaxError',
    'RangeError',
    'ReferenceError',
    'EvalError',
    'URIError',
    'Exception',
    'UnhandledRejection',
  ],
  wrapperTypePrefixes: [
    'PWA Journey API Error',
    'Error at path',
    'UnhandledRejection',
    'Unhandled Promise Rejection',
    'Non-Error promise rejection captured',
  ],
  stateWeight: { NEW: 3, REGRESSED: 3, SURGING: 2.5, CHRONIC: 1, FADING: 0.5 },
  weights: { impact: 1.0, volume: 0.5, velocity: 1.5, recency: 1.0 },
  velocityCeiling: 10,
  velocityEpsilon: 0.01,
  overviewDeltaSignificantPercent: 10,
  timelineTopProblems: 5,
  environmentPreference: ['prod', 'production'],
  cacheSeconds: 60,
}

export function windowPresetFor(token: string | undefined): WindowPreset {
  return (
    WINDOW_PRESETS.find((preset) => preset.token === token) ??
    WINDOW_PRESETS.find((preset) => preset.token === analysisConfig.defaultWindowToken) ??
    WINDOW_PRESETS[0]
  )
}
