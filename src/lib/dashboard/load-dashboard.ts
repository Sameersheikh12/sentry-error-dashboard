import { analyzeIssues } from '@/lib/analysis/analyze'
import { diagnose, type AnalysisDiagnostics } from '@/lib/analysis/diagnose'
import type { InvariantViolation } from '@/lib/analysis/invariants'
import { buildTimeline, type Timeline } from '@/lib/analysis/timeline'
import {
  emptyStateCounts,
  type IssueSnapshot,
  type IssueState,
  type Problem,
} from '@/lib/analysis/types'
import { analysisConfig, windowPresetFor } from '@/lib/config/analysis.config'
import { sentryConfig } from '@/lib/config/sentry.config'
import { logUpstreamRequest } from '@/lib/log'
import { fetchEnvironments, fetchIssueWindow } from '@/lib/sentry/client'
import { newCorrelationId } from '@/lib/sentry/errors'
import type { SentryIssue } from '@/lib/sentry/types'
import { toSnapshots } from './adapter'
import { ALL_ENVIRONMENTS, CUSTOM_WINDOW, type DashboardFilters } from './filters'
import type { ProjectOption } from './load-projects'

const MS_PER_HOUR = 3_600_000

export interface OverviewMetric {
  current: number
  previous: number
  /** Null when there is no comparable prior period — never a percentage against nothing. */
  deltaPercent: number | null
}

export interface BaselineDescription {
  queryStart: string
  hours: number
  /** True when Sentry's retention, not the configured multiplier, decided the span. */
  clampedByRetention: boolean
}

export interface DashboardData {
  /** The clock the analysis ran against, so the UI never reads it during render. */
  now: number
  fetchedAt: string
  project: ProjectOption
  environment?: string
  availableEnvironments: string[]
  /** True when the environment list could not be read, so the query was not narrowed. */
  environmentsUnavailable: boolean
  /** True when the window reaches past Sentry's retention, so "no results" means "no data". */
  windowPrecedesRetention: boolean
  /** Earliest instant Sentry still holds events for, so the picker can refuse older ranges. */
  retentionFloor: string
  windowHours: number
  windowStart: string
  windowEnd: string
  baseline: BaselineDescription
  previousPeriodAvailable: boolean
  truncated: boolean
  /** Above the floors: the things the headline count promises. */
  problems: Problem[]
  /** Below a floor: counted and reachable, never deleted. */
  lowSignalProblems: Problem[]
  overview: {
    events: OverviewMetric
    users: OverviewMetric
    problemStateCounts: Record<IssueState, number>
  }
  timeline: Timeline
  diagnostics: AnalysisDiagnostics
  violations: InvariantViolation[]
}

interface ResolvedWindow {
  start: Date
  end: Date
  hours: number
}

function resolveWindow(filters: DashboardFilters, now: number): ResolvedWindow {
  if (filters.window === CUSTOM_WINDOW && filters.start && filters.end) {
    return {
      start: filters.start,
      end: filters.end,
      hours: (filters.end.getTime() - filters.start.getTime()) / MS_PER_HOUR,
    }
  }

  const preset = windowPresetFor(filters.window)
  return {
    start: new Date(now - preset.hours * MS_PER_HOUR),
    end: new Date(now),
    hours: preset.hours,
  }
}

function buildQuery(filters: DashboardFilters): string {
  const terms = [sentryConfig.issueQuery]
  // Release has to go through the query: the issue list carries no release field to filter on.
  if (filters.release) terms.push(`release:"${filters.release.replace(/"/g, '')}"`)
  return terms.join(' ')
}

function resolveEnvironment(filters: DashboardFilters, available: string[]): string | undefined {
  if (filters.environment === ALL_ENVIRONMENTS) return undefined
  if (filters.environment) return filters.environment
  // Defaulting to production is only safe when the project actually has that environment;
  // filtering to a name that does not exist would render an empty, falsely calm dashboard.
  return analysisConfig.environmentPreference.find((name) => available.includes(name))
}

const totalEvents = (issues: SentryIssue[]) =>
  issues.reduce((sum, issue) => sum + issue.count, 0)

const peakUsers = (issues: SentryIssue[]) =>
  issues.reduce((most, issue) => Math.max(most, issue.userCount), 0)

function metric(current: number, previous: number, comparable: boolean): OverviewMetric {
  return {
    current,
    previous,
    deltaPercent: comparable && previous > 0 ? ((current - previous) / previous) * 100 : null,
  }
}

function matchesSearch(problem: Problem, search: string): boolean {
  const needle = search.toLowerCase()
  if (problem.key.toLowerCase().includes(needle)) return true
  return problem.issues.some((issue) => issue.snapshot.title.toLowerCase().includes(needle))
}

function sortProblems(problems: Problem[], sort: DashboardFilters['sort']): Problem[] {
  const ranked = [...problems]
  switch (sort) {
    case 'users':
      return ranked.sort((a, b) => b.aggregate.userCount - a.aggregate.userCount)
    case 'events':
      return ranked.sort((a, b) => b.aggregate.currentEvents - a.aggregate.currentEvents)
    case 'rate':
      return ranked.sort(
        (a, b) => (b.aggregate.surgeMultiplier ?? -1) - (a.aggregate.surgeMultiplier ?? -1),
      )
    case 'last-seen':
      return ranked.sort((a, b) => b.aggregate.lastSeen - a.aggregate.lastSeen)
    default:
      return ranked.sort((a, b) => b.score - a.score)
  }
}

function applyLevels(snapshots: IssueSnapshot[], levels: string[]): IssueSnapshot[] {
  if (levels.length === 0) return snapshots
  return snapshots.filter((issue) => issue.level && levels.includes(issue.level.toLowerCase()))
}

const emptyWindow = { items: [] as SentryIssue[], truncated: false, fetchedAt: null }

export async function loadDashboard(options: {
  project: ProjectOption
  filters: DashboardFilters
  now?: number
}): Promise<DashboardData> {
  // Snapped to the cache bucket: the Sentry query carries explicit start/end timestamps, so an
  // unrounded clock produces a different URL every second and the response cache never hits —
  // which is the only thing standing between a refresh loop and Sentry's rate limit.
  const bucketMs = Math.max(1, analysisConfig.cacheSeconds) * 1000
  const now = Math.floor((options.now ?? Date.now()) / bucketMs) * bucketMs
  const { filters, project } = options
  const window = resolveWindow(filters, now)
  const windowStart = window.start.getTime()
  const query = buildQuery(filters)

  const environments = await fetchEnvironments(project.slug).then(
    (names) => ({ names, failed: false }),
    () => ({ names: [] as string[], failed: true }),
  )
  const availableEnvironments = environments.names
  const environment = resolveEnvironment(filters, availableEnvironments)

  // Sentry drops events past its retention, so a baseline reaching further back is dividing by a
  // period it has no data for. Clamp the query, and remember why, so the UI can say what it
  // actually compared against.
  const retentionFloor = now - analysisConfig.retentionDays * 24 * MS_PER_HOUR
  // The minimum is a floor on the span we ask for, not a switch that disables short windows: at a
  // 1h window a 6h baseline would be too short to divide by, so ask for a day instead. Problems
  // younger than the minimum still end up with no usable baseline, which is the intended case.
  const requestedBaselineHours = Math.max(
    window.hours * analysisConfig.baselineMultiplier,
    analysisConfig.minBaselineHours,
  )
  const intendedBaselineStart = windowStart - requestedBaselineHours * MS_PER_HOUR
  const baselineQueryStart = Math.max(intendedBaselineStart, retentionFloor)
  const baselineUsable = baselineQueryStart < windowStart

  const previousStart = windowStart - window.hours * MS_PER_HOUR
  const previousPeriodAvailable = previousStart >= retentionFloor

  const [current, baseline, previous] = await Promise.all([
    fetchIssueWindow({
      projectId: project.id,
      start: window.start,
      end: window.end,
      environment,
      query,
      withStats: true,
      windowLabel: 'current',
    }),
    baselineUsable
      ? fetchIssueWindow({
          projectId: project.id,
          start: new Date(baselineQueryStart),
          end: window.start,
          environment,
          query,
          withStats: false,
          windowLabel: 'baseline',
        })
      : Promise.resolve(emptyWindow),
    previousPeriodAvailable
      ? fetchIssueWindow({
          projectId: project.id,
          start: new Date(previousStart),
          end: window.start,
          environment,
          query,
          withStats: false,
          windowLabel: 'previous',
        })
      : Promise.resolve(emptyWindow),
  ])

  const matchesLevel = (issue: SentryIssue) =>
    filters.levels.length === 0 ||
    (issue.level !== null &&
      issue.level !== undefined &&
      filters.levels.includes(issue.level.toLowerCase()))

  const snapshots = applyLevels(toSnapshots(current.items, baseline.items), filters.levels)
  const { problems: allProblems, violations } = analyzeIssues({
    snapshots,
    now,
    windowStart,
    windowEnd: window.end.getTime(),
    windowHours: window.hours,
    baselineQueryStart,
    intendedBaselineStart,
    config: { ...analysisConfig, groupingDimension: filters.grouping },
  })

  if (violations.length > 0) {
    const correlationId = newCorrelationId()
    logUpstreamRequest({
      correlationId,
      operation: 'analysis:invariants',
      project: project.slug,
      window: filters.window,
      environment,
      durationMs: 0,
      errorCode: 'INVARIANT_VIOLATION',
    })
    for (const violation of violations) {
      console.warn(
        JSON.stringify({ at: new Date(now).toISOString(), correlationId, ...violation }),
      )
    }
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(
        `Analysis invariants failed (${violations.length}). First: ${violations[0].subject} — ${violations[0].rule}: ${violations[0].detail}`,
      )
    }
  }

  const analyzedIssues = allProblems.flatMap((problem) => problem.issues)
  const diagnostics = diagnose(snapshots, analyzedIssues, allProblems, violations.length)

  const matching = allProblems
    .filter((problem) => filters.states.length === 0 || filters.states.includes(problem.state))
    .filter((problem) => !filters.search || matchesSearch(problem, filters.search))

  const sorted = sortProblems(matching, filters.sort)
  const aboveThreshold = sorted.filter((problem) => !problem.belowThreshold)

  // Counts describe the problems actually on screen. The unfiltered distribution stays available
  // in diagnostics, where it is labelled as such.
  const visibleStateCounts = emptyStateCounts()
  for (const problem of aboveThreshold) visibleStateCounts[problem.state] += 1

  return {
    now,
    fetchedAt: current.fetchedAt ?? new Date(now).toISOString(),
    project,
    environment,
    availableEnvironments,
    environmentsUnavailable: environments.failed,
    windowPrecedesRetention: windowStart < retentionFloor,
    retentionFloor: new Date(retentionFloor).toISOString(),
    windowHours: window.hours,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    baseline: {
      queryStart: new Date(baselineQueryStart).toISOString(),
      hours: baselineUsable ? (windowStart - baselineQueryStart) / MS_PER_HOUR : 0,
      clampedByRetention: retentionFloor > intendedBaselineStart,
    },
    previousPeriodAvailable,
    truncated: current.truncated || baseline.truncated,
    problems: aboveThreshold,
    lowSignalProblems: sorted.filter((problem) => problem.belowThreshold),
    overview: {
      // Filtered the same way the table is, or the band contradicts the rows beneath it.
      events: metric(
        totalEvents(current.items.filter(matchesLevel)),
        totalEvents(previous.items.filter(matchesLevel)),
        previousPeriodAvailable,
      ),
      users: metric(
        peakUsers(current.items.filter(matchesLevel)),
        peakUsers(previous.items.filter(matchesLevel)),
        previousPeriodAvailable,
      ),
      problemStateCounts: visibleStateCounts,
    },
    timeline: buildTimeline(sorted, {
      windowEnd: window.end.getTime(),
      topProblems: analysisConfig.timelineTopProblems,
    }),
    diagnostics,
    violations,
  }
}
