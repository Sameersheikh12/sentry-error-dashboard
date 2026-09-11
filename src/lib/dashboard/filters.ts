import { STATE_SEVERITY, type GroupingDimension, type IssueState } from '@/lib/analysis/types'
import { WINDOW_PRESETS, analysisConfig } from '@/lib/config/analysis.config'

export const SORT_KEYS = ['score', 'users', 'events', 'rate', 'last-seen'] as const
export type SortKey = (typeof SORT_KEYS)[number]

export const LEVELS = ['error', 'warning', 'fatal'] as const

export const CUSTOM_WINDOW = 'custom'

/** Explicit "no environment filter", as distinct from "not specified, so use the default". */
export const ALL_ENVIRONMENTS = 'all'

export interface DashboardFilters {
  projectSlug?: string
  /**
   * The raw URL value: undefined means "unspecified, fall back to the preferred environment",
   * ALL_ENVIRONMENTS means the user deliberately widened to every environment. Keeping the two
   * apart is what lets "clear all" actually clear it.
   */
  environment?: string
  /** A preset token, or CUSTOM_WINDOW when start/end are set explicitly. */
  window: string
  start?: Date
  end?: Date
  states: IssueState[]
  levels: string[]
  release?: string
  search?: string
  sort: SortKey
  grouping: GroupingDimension
  /** The chart is useful but not always wanted; keep the choice in the URL like every filter. */
  showChart: boolean
}

export type RawParams = Record<string, string | string[] | undefined>

function single(params: RawParams, name: string): string | undefined {
  const value = params[name]
  const text = Array.isArray(value) ? value[0] : value
  return text && text.trim() !== '' ? text.trim() : undefined
}

function list(params: RawParams, name: string): string[] {
  return (single(params, name)?.split(',') ?? []).map((entry) => entry.trim()).filter(Boolean)
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed) : undefined
}

export function parseFilters(params: RawParams): DashboardFilters {
  const start = parseDate(single(params, 'start'))
  const end = parseDate(single(params, 'end'))
  const hasCustomRange = Boolean(start && end && start < end)

  const requestedWindow = single(params, 'window')
  const window = hasCustomRange
    ? CUSTOM_WINDOW
    : (WINDOW_PRESETS.find((preset) => preset.token === requestedWindow)?.token ??
      analysisConfig.defaultWindowToken)

  const requestedStates = list(params, 'state').map((entry) => entry.toUpperCase())
  const requestedSort = single(params, 'sort')
  const requestedGrouping = single(params, 'grouping')

  return {
    projectSlug: single(params, 'project'),
    environment: single(params, 'env'),
    window,
    start: hasCustomRange ? start : undefined,
    end: hasCustomRange ? end : undefined,
    states: STATE_SEVERITY.filter((state) => requestedStates.includes(state)),
    levels: list(params, 'level').filter((level) =>
      (LEVELS as readonly string[]).includes(level.toLowerCase()),
    ),
    release: single(params, 'release'),
    search: single(params, 'q'),
    sort: SORT_KEYS.includes(requestedSort as SortKey) ? (requestedSort as SortKey) : 'score',
    grouping: requestedGrouping === 'none' ? 'none' : analysisConfig.groupingDimension,
    showChart: single(params, 'chart') !== 'off',
  }
}

/**
 * What the user has actively narrowed to. Project and window are always set, so they are not
 * "filters" in the sense of something to count or clear.
 */
export function activeFilterCount(filters: DashboardFilters): number {
  return [
    filters.environment !== undefined,
    filters.states.length > 0,
    filters.levels.length > 0,
    Boolean(filters.release),
    Boolean(filters.search),
    filters.grouping === 'none',
  ].filter(Boolean).length
}

export function clearedFilters(filters: DashboardFilters): DashboardFilters {
  return {
    ...filters,
    environment: undefined,
    states: [],
    levels: [],
    release: undefined,
    search: undefined,
    grouping: analysisConfig.groupingDimension,
  }
}

/** Every filter round-trips through the URL, so a shared link reproduces the view exactly. */
export function filtersToQueryString(filters: DashboardFilters): string {
  const params = new URLSearchParams()
  if (filters.projectSlug) params.set('project', filters.projectSlug)
  if (filters.environment) params.set('env', filters.environment)

  if (filters.window === CUSTOM_WINDOW && filters.start && filters.end) {
    params.set('start', filters.start.toISOString())
    params.set('end', filters.end.toISOString())
  } else {
    params.set('window', filters.window)
  }

  if (filters.states.length > 0) params.set('state', filters.states.join(',').toLowerCase())
  if (filters.levels.length > 0) params.set('level', filters.levels.join(','))
  if (filters.release) params.set('release', filters.release)
  if (filters.search) params.set('q', filters.search)
  if (filters.sort !== 'score') params.set('sort', filters.sort)
  if (filters.grouping === 'none') params.set('grouping', 'none')
  if (!filters.showChart) params.set('chart', 'off')

  return params.toString()
}

export function withFilter(
  filters: DashboardFilters,
  changes: Partial<DashboardFilters>,
): string {
  return `/?${filtersToQueryString({ ...filters, ...changes })}`
}
