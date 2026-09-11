'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { STATE_SEVERITY, type IssueState } from '@/lib/analysis/types'
import {
  ALL_ENVIRONMENTS,
  LEVELS,
  SORT_KEYS,
  activeFilterCount,
  clearedFilters,
  filtersToQueryString,
  withFilter,
  type DashboardFilters,
  type SortKey,
} from '@/lib/dashboard/filters'
import type { ProjectOption } from '@/lib/dashboard/load-projects'
import {
  CONTROL_SELECT,
  FAINT_TEXT,
  PILL_ACTIVE,
  PILL_BASE,
  PILL_RESTING,
} from './controls'
import { STATE_STYLES } from './state-styles'
import { WindowPicker } from './WindowPicker'

function Toggle({
  active,
  onClick,
  label,
  title,
}: {
  active: boolean
  onClick: () => void
  label: string
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`${PILL_BASE} ${active ? PILL_ACTIVE : PILL_RESTING}`}
    >
      {/* Never colour alone: the active state carries a glyph too. */}
      <span aria-hidden className={active ? '' : 'opacity-0'}>
        ✓
      </span>
      {label}
    </button>
  )
}

export function FilterBar({
  filters,
  projects,
  environments,
  effectiveEnvironment,
  windowLabel,
  retentionFloor,
}: {
  filters: DashboardFilters
  projects: ProjectOption[]
  environments: string[]
  /** What the server actually queried, which may be the configured default. */
  effectiveEnvironment?: string
  windowLabel: string
  retentionFloor?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // `filters` only updates once the navigation lands, so two changes made during one pending
  // transition would both build on the pre-navigation value and the first would be silently
  // discarded. Pending changes accumulate here and reset when the new URL arrives.
  const applied = filtersToQueryString(filters)
  const [draft, setDraft] = useState<{ base: string; changes: Partial<DashboardFilters> }>({
    base: applied,
    changes: {},
  })
  // Derived, not reset in an effect: the draft belongs to the URL it was built from, so it
  // invalidates itself the moment a navigation lands.
  const pending = draft.base === applied ? draft.changes : {}

  const go = (changes: Partial<DashboardFilters>) => {
    const merged = { ...pending, ...changes }
    setDraft({ base: applied, changes: merged })
    startTransition(() => router.push(withFilter({ ...filters, ...merged }, {})))
  }

  const activeCount = activeFilterCount(filters)

  // Include whatever is actually in force, even if this project does not define it, or the select
  // would fall back to its first option and report an environment that is not being applied.
  const inForce = filters.environment ?? effectiveEnvironment
  const selectableEnvironments =
    inForce && inForce !== ALL_ENVIRONMENTS && !environments.includes(inForce)
      ? [inForce, ...environments]
      : environments

  const toggleState = (state: IssueState) =>
    go({
      states: filters.states.includes(state)
        ? filters.states.filter((entry) => entry !== state)
        : [...filters.states, state],
    })

  const toggleLevel = (level: string) =>
    go({
      levels: filters.levels.includes(level)
        ? filters.levels.filter((entry) => entry !== level)
        : [...filters.levels, level],
    })

  const submitText =
    (name: 'search' | 'release') => (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') return
      go({ [name]: event.currentTarget.value.trim() || undefined })
    }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {projects.length > 0 && (
          <select
            value={filters.projectSlug ?? ''}
            // Environments are defined per project, so carrying one across would filter the new
            // project by a name it may not have and return nothing.
            onChange={(event) => go({ projectSlug: event.target.value, environment: undefined })}
            className={CONTROL_SELECT}
            aria-label="Project"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.slug}>
                {project.slug}
              </option>
            ))}
          </select>
        )}

        <select
          value={filters.environment ?? effectiveEnvironment ?? ALL_ENVIRONMENTS}
          onChange={(event) => go({ environment: event.target.value })}
          className={CONTROL_SELECT}
          aria-label="Environment"
        >
          <option value={ALL_ENVIRONMENTS}>all environments</option>
          {selectableEnvironments.map((environment) => (
            <option key={environment} value={environment}>
              {environment}
              {environments.includes(environment) ? '' : ' (not in this project)'}
            </option>
          ))}
        </select>

        <WindowPicker
          filters={filters}
          windowLabel={windowLabel}
          earliestIso={retentionFloor}
          onApply={go}
        />

        <input
          type="search"
          key={`search:${filters.search ?? ''}`}
          defaultValue={filters.search ?? ''}
          onKeyDown={submitText('search')}
          placeholder="search… (enter)"
          className={`${CONTROL_SELECT} w-44`}
          aria-label="Search problems and issue titles"
        />

        <input
          type="text"
          key={`release:${filters.release ?? ''}`}
          defaultValue={filters.release ?? ''}
          onKeyDown={submitText('release')}
          placeholder="release… (enter)"
          className={`${CONTROL_SELECT} w-36`}
          aria-label="Filter by release"
        />

        <select
          value={filters.sort}
          onChange={(event) => go({ sort: event.target.value as SortKey })}
          className={CONTROL_SELECT}
          aria-label="Sort by"
        >
          {SORT_KEYS.map((key) => (
            <option key={key} value={key}>
              sort: {key}
            </option>
          ))}
        </select>

        <select
          value={filters.grouping}
          onChange={(event) =>
            go({ grouping: event.target.value === 'none' ? 'none' : 'signature' })
          }
          className={CONTROL_SELECT}
          aria-label="Grouping"
        >
          <option value="signature">grouped</option>
          <option value="none">one row per issue</option>
        </select>

        <Toggle
          active={filters.showChart}
          onClick={() => go({ showChart: !filters.showChart })}
          label="Chart"
          title="Show or hide the volume chart"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${FAINT_TEXT}`}>
          State
        </span>
        {STATE_SEVERITY.map((state) => (
          <Toggle
            key={state}
            active={filters.states.includes(state)}
            onClick={() => toggleState(state)}
            label={STATE_STYLES[state].label}
          />
        ))}

        <span className={`ml-3 text-[11px] font-semibold uppercase tracking-wide ${FAINT_TEXT}`}>
          Level
        </span>
        {LEVELS.map((level) => (
          <Toggle
            key={level}
            active={filters.levels.includes(level)}
            onClick={() => toggleLevel(level)}
            label={level}
          />
        ))}

        <span className="ml-auto flex items-center gap-3">
          {isPending && (
            <span className={`text-xs ${FAINT_TEXT}`} role="status">
              updating…
            </span>
          )}
          <span className={`text-xs tabular-nums ${FAINT_TEXT}`}>
            {activeCount === 0
              ? 'no filters applied'
              : `${activeCount} filter${activeCount === 1 ? '' : 's'} applied`}
          </span>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => go(clearedFilters(filters))}
              className={`${PILL_BASE} ${PILL_RESTING}`}
            >
              Clear all
            </button>
          )}
        </span>
      </div>
    </div>
  )
}
