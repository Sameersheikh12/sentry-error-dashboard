import { analyzeIssues } from '@/lib/analysis/analyze'
import type { IssueSnapshot, Problem, StatsPoint } from '@/lib/analysis/types'
import { analysisConfig, type AnalysisConfig } from '@/lib/config/analysis.config'

const MS_PER_HOUR = 3_600_000

export const NOW = Date.parse('2026-09-09T12:00:00.000Z')
export const WINDOW_HOURS = 24
export const WINDOW_START = NOW - WINDOW_HOURS * MS_PER_HOUR
export const BASELINE_HOURS = WINDOW_HOURS * analysisConfig.baselineMultiplier
export const BASELINE_QUERY_START = WINDOW_START - BASELINE_HOURS * MS_PER_HOUR
export const config = analysisConfig

export function buckets(perBucket: number[], now = NOW): StatsPoint[] {
  return perBucket.map((events, index) => ({
    timestamp: now - (perBucket.length - 1 - index) * MS_PER_HOUR,
    events,
  }))
}

export function spread(totalEvents: number, count = WINDOW_HOURS): StatsPoint[] {
  const base = Math.floor(totalEvents / count)
  const remainder = totalEvents - base * count
  return buckets(Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0)))
}

export function snapshot(overrides: Partial<IssueSnapshot> = {}): IssueSnapshot {
  const currentEvents = overrides.currentEvents ?? 0
  return {
    id: '1',
    shortId: 'WEB-1',
    title: 'TypeError: undefined is not a function',
    culprit: '/api/accounts/8f2c-41ab/emi',
    permalink: 'https://sentry.io/organizations/acme/issues/1/',
    exceptionType: 'TypeError',
    level: 'error',
    status: 'unresolved',
    substatus: 'ongoing',
    firstSeen: NOW - 30 * 24 * MS_PER_HOUR,
    lastSeen: NOW,
    currentEvents,
    baselineEvents: 0,
    userCount: 0,
    buckets: spread(currentEvents),
    ...overrides,
  }
}

/** An issue running at `baselinePerDay` that then does `currentEvents` inside the window. */
export function withHistory(options: {
  baselinePerDay: number
  currentEvents: number
  overrides?: Partial<IssueSnapshot>
}): IssueSnapshot {
  return snapshot({
    currentEvents: options.currentEvents,
    baselineEvents: options.baselinePerDay * (BASELINE_HOURS / 24),
    buckets: spread(options.currentEvents),
    ...options.overrides,
  })
}

export function analyzeFull(
  snapshots: IssueSnapshot[],
  overrides: Partial<AnalysisConfig> = {},
) {
  return analyzeIssues({
    snapshots,
    now: NOW,
    windowStart: WINDOW_START,
    windowEnd: NOW,
    windowHours: WINDOW_HOURS,
    baselineQueryStart: BASELINE_QUERY_START,
    intendedBaselineStart: BASELINE_QUERY_START,
    config: { ...analysisConfig, ...overrides },
  })
}

/** Throws on any invariant violation, so an unrealistic fixture fails loudly instead of vanishing. */
export function analyze(
  snapshots: IssueSnapshot[],
  overrides: Partial<AnalysisConfig> = {},
): Problem[] {
  const { problems, violations } = analyzeFull(snapshots, overrides)
  if (violations.length > 0) {
    throw new Error(
      `fixture violates an invariant: ${violations.map((v) => `${v.subject} ${v.rule} (${v.detail})`).join('; ')}`,
    )
  }
  return problems
}
