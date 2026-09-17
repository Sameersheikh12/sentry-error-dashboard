import type { IssueState } from '@/lib/analysis/types'
import type { OverviewMetric } from '@/lib/dashboard/load-dashboard'
import { analysisConfig } from '@/lib/config/analysis.config'
import { DELTA_BETTER_TEXT, DELTA_WORSE_TEXT, FAINT_TEXT, MUTED_TEXT } from './controls'
import { formatCount, formatDelta } from './format'
import { STATE_STYLES } from './state-styles'

function deltaTone(deltaPercent: number | null): string {
  if (deltaPercent === null) return FAINT_TEXT

  const significant = analysisConfig.overviewDeltaSignificantPercent
  if (deltaPercent > significant) return DELTA_WORSE_TEXT
  if (deltaPercent < -significant) return DELTA_BETTER_TEXT
  return FAINT_TEXT
}

function Metric({
  label,
  metric,
  windowLabel,
  comparable,
  prefix = '',
}: {
  label: string
  metric: OverviewMetric
  windowLabel: string
  comparable: boolean
  prefix?: string
}) {
  return (
    <div className="min-w-36 flex-1 sm:flex-none">
      <p className={`text-[11px] font-semibold uppercase tracking-wide ${MUTED_TEXT}`}>{label}</p>
      <p className="text-xl font-semibold tabular-nums">
        {prefix}
        {formatCount(metric.current)}
      </p>
      <p className={`text-xs tabular-nums ${deltaTone(metric.deltaPercent)}`}>
        {comparable
          ? `${formatDelta(metric.deltaPercent)} vs previous ${windowLabel}`
          : 'no comparable prior period within retention'}
      </p>
    </div>
  )
}

export function OverviewBand({
  events,
  users,
  problemStateCounts,
  windowLabel,
  comparable,
}: {
  events: OverviewMetric
  users: OverviewMetric
  problemStateCounts: Record<IssueState, number>
  windowLabel: string
  comparable: boolean
}) {
  const states = (Object.keys(STATE_STYLES) as IssueState[]).filter(
    (state) => problemStateCounts[state] > 0,
  )

  return (
    <section className="flex flex-wrap items-start gap-x-10 gap-y-4 rounded-lg border border-slate-500/20 px-4 py-3">
      <Metric label="Events" metric={events} windowLabel={windowLabel} comparable={comparable} />
      <Metric
        label="Users affected"
        metric={users}
        windowLabel={windowLabel}
        comparable={comparable}
        prefix="≥"
      />

      <div>
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${MUTED_TEXT}`}>
          Problems by state
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {states.length === 0 ? (
            <span className={`text-sm ${MUTED_TEXT}`}>none</span>
          ) : (
            states.map((state) => (
              <span
                key={state}
                className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-sm ring-1 ring-inset ${STATE_STYLES[state].badge}`}
              >
                <span className="tabular-nums font-semibold">{problemStateCounts[state]}</span>
                {STATE_STYLES[state].label}
              </span>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
