import type { IssueState } from '@/lib/analysis/types'
import { CAUTION_TEXT, FAINT_TEXT, MUTED_TEXT } from './controls'
import { formatUtc } from './format'

export function VerdictHeadline({
  worthLooking,
  belowThreshold,
  problemStateCounts,
  windowLabel,
  baselineNote,
  fetchedAt,
  issuesScanned,
  truncated,
}: {
  worthLooking: number
  belowThreshold: number
  problemStateCounts: Record<IssueState, number>
  windowLabel: string
  baselineNote: string
  fetchedAt: string
  issuesScanned: number
  truncated: boolean
}) {
  const breakdown = (['NEW', 'REGRESSED', 'SURGING'] as const)
    .filter((state) => problemStateCounts[state] > 0)
    .map((state) => `${problemStateCounts[state]} ${state.toLowerCase()}`)

  return (
    <div>
      {worthLooking > 0 ? (
        <p className="text-2xl font-semibold">
          {worthLooking} problem{worthLooking === 1 ? '' : 's'} worth looking at
          {breakdown.length > 0 && (
            <span className={`ml-2 text-base font-normal ${MUTED_TEXT}`}>
              {breakdown.join(' · ')}
            </span>
          )}
        </p>
      ) : (
        <p className={`text-2xl font-semibold ${MUTED_TEXT}`}>Nothing new in {windowLabel}</p>
      )}

      <p className={`mt-1 text-xs tabular-nums ${FAINT_TEXT}`}>
        {belowThreshold > 0 && `${belowThreshold} below threshold · `}
        {issuesScanned.toLocaleString('en-US')} Sentry issues scanned · compared against{' '}
        {baselineNote} · data as of {formatUtc(fetchedAt)}
      </p>

      {truncated && (
        <p className={`mt-1 text-xs font-medium ${CAUTION_TEXT}`}>
          Sentry had more issues than this page walked — the ranking below is incomplete. Raise
          maxPages in sentry.config.ts.
        </p>
      )}
    </div>
  )
}
