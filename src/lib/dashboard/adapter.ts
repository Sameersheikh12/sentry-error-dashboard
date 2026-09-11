import { scrubTitle } from '@/lib/analysis/normalize'
import type { IssueSnapshot, StatsPoint } from '@/lib/analysis/types'
import type { SentryIssue } from '@/lib/sentry/types'

const MS_PER_SECOND = 1000

function toStatsPoints(stats: SentryIssue['stats']): StatsPoint[] {
  // Sentry keys the series by the groupStatsPeriod it used; with a custom range that is "auto".
  const series = stats ? Object.values(stats)[0] : undefined
  return (series ?? []).map(([unixSeconds, events]) => ({
    timestamp: unixSeconds * MS_PER_SECOND,
    events,
  }))
}

function baseSnapshot(issue: SentryIssue): Omit<
  IssueSnapshot,
  'currentEvents' | 'baselineEvents' | 'userCount' | 'buckets'
> {
  return {
    id: issue.id,
    shortId: issue.shortId,
    // Scrubbed once, here: embedded journey ids and timestamps make every title unique, so
    // nothing can group and the identifiers end up on screen with no diagnostic value.
    title: scrubTitle(issue.title),
    culprit: issue.culprit ?? null,
    permalink: issue.permalink,
    exceptionType: issue.metadata?.type ?? null,
    level: issue.level ?? null,
    status: issue.status,
    substatus: issue.substatus ?? null,
    // Lifetime, never the range-scoped value: NEW must mean "never seen before this window",
    // not "the query range started here".
    firstSeen: Date.parse(issue.lifetime?.firstSeen ?? issue.firstSeen),
    lastSeen: Date.parse(issue.lastSeen),
  }
}

/**
 * Sentry scopes `count` and `userCount` to the queried date range, so the current and baseline
 * windows are two separate queries rather than one range with a subtraction. Issues present only
 * in the baseline still matter — those are the ones that have stopped.
 */
export function toSnapshots(
  currentWindow: SentryIssue[],
  baselineWindow: SentryIssue[],
): IssueSnapshot[] {
  const baselineById = new Map(baselineWindow.map((issue) => [issue.id, issue]))
  const snapshots = currentWindow.map((issue) => ({
    ...baseSnapshot(issue),
    currentEvents: issue.count,
    baselineEvents: baselineById.get(issue.id)?.count ?? 0,
    userCount: issue.userCount,
    buckets: toStatsPoints(issue.stats),
  }))

  const seen = new Set(currentWindow.map((issue) => issue.id))
  for (const issue of baselineWindow) {
    if (seen.has(issue.id)) continue
    snapshots.push({
      ...baseSnapshot(issue),
      currentEvents: 0,
      baselineEvents: issue.count,
      // Zero, not the baseline-period figure. This issue produced nothing in the window, and its
      // baseline users would otherwise surface as the problem's headline user count.
      userCount: 0,
      buckets: [],
    })
  }

  return snapshots
}
