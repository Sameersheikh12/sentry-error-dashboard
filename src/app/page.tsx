import { BACKGROUND_STATES } from '@/lib/analysis/types'
import { AgentPanel } from '@/components/dashboard/AgentPanel'
import { agentConfig, agentTimeoutSeconds } from '@/lib/config/agent.config'
import { DiagnosticsPanel } from '@/components/dashboard/DiagnosticsPanel'
import { ErrorState } from '@/components/dashboard/ErrorState'
import { FilterBar } from '@/components/dashboard/FilterBar'
import { OverviewBand } from '@/components/dashboard/OverviewBand'
import { ProblemTable } from '@/components/dashboard/ProblemTable'
import { StateLegend } from '@/components/dashboard/StateLegend'
import { TimelineChart } from '@/components/dashboard/TimelineChart'
import { VerdictHeadline } from '@/components/dashboard/VerdictHeadline'
import {
  DANGER_SURFACE,
  MUTED_TEXT,
  WARNING_SURFACE,
  WARNING_TEXT,
} from '@/components/dashboard/controls'
import { WINDOW_PRESETS, analysisConfig } from '@/lib/config/analysis.config'
import { serverEnvironment } from '@/lib/config/env'
import { unauthenticatedProduction } from '@/lib/config/guard'
import {
  CUSTOM_WINDOW,
  activeFilterCount,
  parseFilters,
  type DashboardFilters,
} from '@/lib/dashboard/filters'
import { filtersToQueryString } from '@/lib/dashboard/filters'
import { loadDashboard, type BaselineDescription } from '@/lib/dashboard/load-dashboard'
import { loadProjects, resolveProject, type ProjectOption } from '@/lib/dashboard/load-projects'
import { describeFailure } from '@/lib/failure'
import { SentryNotFoundError } from '@/lib/sentry/errors'

type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown }

async function attempt<T>(run: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, error }
  }
}

interface WindowLabels {
  picker: string
  verdict: string
  comparison: string
}

function windowLabels(filters: DashboardFilters): WindowLabels {
  if (filters.window === CUSTOM_WINDOW && filters.start && filters.end) {
    const range = `${filters.start.toISOString().slice(0, 16)} → ${filters.end.toISOString().slice(0, 16)} UTC`
    return { picker: range, verdict: 'the selected range', comparison: 'period' }
  }

  const preset = WINDOW_PRESETS.find((entry) => entry.token === filters.window)
  const label = preset?.label ?? filters.window
  return {
    picker: label,
    verdict: label.toLowerCase(),
    comparison: label.replace(/^Last /, ''),
  }
}

/** Never claim to have compared against a period Sentry could not supply. */
function describeBaseline(baseline: BaselineDescription): string {
  if (baseline.hours <= 0) return 'no usable baseline'

  const days = baseline.hours / 24
  const span = days >= 1 ? `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}` : `${Math.round(baseline.hours)}h`
  return baseline.clampedByRetention ? `${span} (capped by Sentry retention)` : span
}

// A missing environment surfaces loudly through the fetches below; there is nothing to gain from
// letting it throw while picking a default.
function configuredDefaultProject(): string | undefined {
  try {
    return serverEnvironment().SENTRY_DEFAULT_PROJECT
  } catch {
    return undefined
  }
}

function apiBaseUrl(): string {
  try {
    return serverEnvironment().SENTRY_API_BASE_URL
  } catch {
    return 'https://sentry.io'
  }
}

export default async function Page({ searchParams }: PageProps<'/'>) {
  const filters = parseFilters(await searchParams)
  const labels = windowLabels(filters)

  const projectsAttempt = await attempt(loadProjects)
  const projects: ProjectOption[] = projectsAttempt.ok ? projectsAttempt.value : []
  const project = resolveProject(projects, filters.projectSlug, configuredDefaultProject())

  const dashboard = project ? await attempt(() => loadDashboard({ project, filters })) : null

  // Deliberately not overwriting `environment` with the resolved value: the URL value is what
  // "filters applied" counts and what "clear all" resets. The resolved one is display only.
  const resolvedFilters: DashboardFilters = {
    ...filters,
    projectSlug: project?.slug ?? filters.projectSlug,
  }

  return (
    <main className="mx-auto w-full max-w-screen-2xl space-y-8 p-4 pb-24 sm:p-6 sm:pb-24">
      {unauthenticatedProduction() && (
        <p className={`rounded border-2 px-4 py-2 text-sm font-semibold ${DANGER_SURFACE}`}>
          Running in production with no access gate. This page exposes a Sentry token with
          organization-wide read access — do not leave it reachable.
        </p>
      )}

      <header className="space-y-4">
        <h1 className={`text-sm font-semibold uppercase tracking-widest ${MUTED_TEXT}`}>
          Sentry triage
        </h1>
        <FilterBar
          filters={resolvedFilters}
          projects={projects}
          environments={dashboard?.ok ? dashboard.value.availableEnvironments : []}
          effectiveEnvironment={dashboard?.ok ? dashboard.value.environment : undefined}
          windowLabel={labels.picker}
          retentionFloor={dashboard?.ok ? dashboard.value.retentionFloor : undefined}
        />
      </header>

      {dashboard?.ok && dashboard.value.environmentsUnavailable && (
        <p className="rounded border border-amber-500/50 bg-amber-500/5 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
          Could not read this project&apos;s environment list, so results are not narrowed to one
          environment. The figures below cover every environment.
        </p>
      )}

      {dashboard?.ok && dashboard.value.windowPrecedesRetention && (
        <p className="rounded border border-amber-500/50 bg-amber-500/5 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
          This window reaches past Sentry&apos;s {analysisConfig.retentionDays}-day retention.
          Anything before then is missing rather than quiet.
        </p>
      )}

      {!projectsAttempt.ok && dashboard?.ok && (
        <p className={`rounded border px-4 py-2 text-sm ${WARNING_SURFACE} ${WARNING_TEXT}`}>
          Could not list projects, so the project picker is unavailable. The problems below are
          still current.
        </p>
      )}

      {dashboard === null ? (
        <ErrorState
          error={
            describeFailure(
              projectsAttempt.ok
                ? new SentryNotFoundError(
                    'No project matching this selection in this organization.',
                    `The organization returned ${projects.length} projects.`,
                  )
                : projectsAttempt.error,
            ).error
          }
        />
      ) : dashboard.ok ? (
        <>
          {/* The answer, and the agent's reading of it. These belong together. */}
          <section className="space-y-3">
            <VerdictHeadline
              worthLooking={dashboard.value.problems.length}
              needingAttention={
                dashboard.value.problems.filter(
                  (problem) => !BACKGROUND_STATES.includes(problem.state),
                ).length
              }
              belowThreshold={dashboard.value.lowSignalProblems.length}
              problemStateCounts={dashboard.value.overview.problemStateCounts}
              windowLabel={labels.verdict}
              baselineNote={describeBaseline(dashboard.value.baseline)}
              fetchedAt={dashboard.value.fetchedAt}
              issuesScanned={dashboard.value.diagnostics.issuesScanned}
              truncated={dashboard.value.truncated}
            />
            <AgentPanel
              key={filtersToQueryString(resolvedFilters)}
              query={filtersToQueryString(resolvedFilters)}
              models={agentConfig.selectableModels}
              efforts={agentConfig.selectableEfforts}
              defaultModel={agentConfig.model}
              defaultEffort={agentConfig.effort}
              timeoutSeconds={agentTimeoutSeconds}
            />
          </section>

          {/* The measurements behind it: totals, then the shape over time. */}
          <section className="space-y-3">
            <OverviewBand
              events={dashboard.value.overview.events}
              users={dashboard.value.overview.users}
              problemStateCounts={dashboard.value.overview.problemStateCounts}
              windowLabel={labels.comparison}
              comparable={dashboard.value.previousPeriodAvailable}
            />
            {filters.showChart && <TimelineChart timeline={dashboard.value.timeline} />}
          </section>

          <ProblemTable
            problems={dashboard.value.problems}
            lowSignalProblems={dashboard.value.lowSignalProblems}
            now={dashboard.value.now}
            apiBaseUrl={apiBaseUrl()}
            filtersActive={activeFilterCount(filters) > 0}
          />

          {/* How to read the above. Reference, so it sits apart and recedes. */}
          <section className="space-y-2">
            <StateLegend />
            <DiagnosticsPanel
              diagnostics={dashboard.value.diagnostics}
              baselineHours={dashboard.value.baseline.hours}
            />
          </section>
        </>
      ) : (
        <ErrorState error={describeFailure(dashboard.error).error} />
      )}
    </main>
  )
}
