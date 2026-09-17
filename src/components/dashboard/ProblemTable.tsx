import { BACKGROUND_STATES, type Problem } from '@/lib/analysis/types'
import {
  CELL_RATE,
  CELL_USERS,
  CELL_WIDE,
  FAINT_TEXT,
  MUTED_TEXT,
  NUMERIC_CELL,
  ROW_GRID,
} from './controls'
import { ProblemRow } from './ProblemRow'

function HeaderRow() {
  return (
    <div
      className={`${ROW_GRID} border-b border-slate-500/30 pb-1.5 text-[11px] font-semibold uppercase tracking-wide ${MUTED_TEXT}`}
    >
      <span>State</span>
      <span>Problem</span>
      <span
        className={`${CELL_USERS} ${NUMERIC_CELL} cursor-help decoration-dotted underline-offset-2 hover:underline`}
        title="Users affected in the window. A grouped problem shows ≥ because Sentry counts users per issue and cannot de-duplicate them across a group; a single-issue problem is exact."
      >
        Users
      </span>
      <span className={NUMERIC_CELL}>Events</span>
      <span
        className={`${CELL_RATE} ${NUMERIC_CELL} cursor-help decoration-dotted underline-offset-2 hover:underline`}
        title="Current rate against this problem's own baseline. A dash means there is no usable baseline to compare against."
      >
        Rate
      </span>
      <span className={CELL_WIDE}>Volume</span>
      <span className={`${CELL_WIDE} ${NUMERIC_CELL}`}>Last seen</span>
    </div>
  )
}

function Section({
  problems,
  now,
  apiBaseUrl,
}: {
  problems: Problem[]
  now: number
  apiBaseUrl: string
}) {
  return (
    <section>
      <HeaderRow />
      {problems.map((problem) => (
        <ProblemRow key={problem.key} problem={problem} now={now} apiBaseUrl={apiBaseUrl} />
      ))}
    </section>
  )
}

function Disclosure({
  summary,
  problems,
  now,
  apiBaseUrl,
}: {
  summary: string
  problems: Problem[]
  now: number
  apiBaseUrl: string
}) {
  return (
    <details className="group rounded-lg border border-dashed border-slate-500/35">
      <summary
        className={`cursor-pointer list-none rounded-lg px-3 py-2.5 text-sm ${MUTED_TEXT} hover:bg-slate-500/5`}
      >
        <span className="group-open:hidden">▸ Show </span>
        <span className="hidden group-open:inline">▾ Hide </span>
        {summary}
      </summary>
      <div className="pb-2">
        <Section problems={problems} now={now} apiBaseUrl={apiBaseUrl} />
      </div>
    </details>
  )
}

export function ProblemTable({
  problems,
  lowSignalProblems,
  now,
  apiBaseUrl,
  filtersActive,
}: {
  problems: Problem[]
  lowSignalProblems: Problem[]
  now: number
  apiBaseUrl: string
  filtersActive: boolean
}) {
  const needsAttention = problems.filter((problem) => !BACKGROUND_STATES.includes(problem.state))
  const background = problems.filter((problem) => BACKGROUND_STATES.includes(problem.state))
  const total = problems.length + lowSignalProblems.length

  // Reached only on a successful fetch, so this calm wording is always truthful. Anything that
  // failed renders ErrorState instead and never gets here.
  if (total === 0) {
    return (
      <section className="rounded-lg border border-slate-500/25 p-5">
        <h2 className="text-lg font-semibold">No problems found</h2>
        <p className={`mt-1 text-sm ${MUTED_TEXT}`}>
          Sentry answered, and nothing matched{' '}
          {filtersActive ? 'this window and these filters' : 'this window'}. Nothing is being
          hidden from you.
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <p className={`text-xs tabular-nums ${FAINT_TEXT}`}>
        Showing {needsAttention.length} of {total} problems
        {background.length > 0 && ` · ${background.length} running as usual`}
        {lowSignalProblems.length > 0 && ` · ${lowSignalProblems.length} below threshold`}
      </p>

      {needsAttention.length > 0 && (
        <Section problems={needsAttention} now={now} apiBaseUrl={apiBaseUrl} />
      )}

      {background.length > 0 && (
        <Disclosure
          summary={`${background.length} background problem${background.length === 1 ? '' : 's'} running as usual`}
          problems={background}
          now={now}
          apiBaseUrl={apiBaseUrl}
        />
      )}

      {lowSignalProblems.length > 0 && (
        <Disclosure
          summary={`${lowSignalProblems.length} below the signal threshold — too few events or users to act on`}
          problems={lowSignalProblems}
          now={now}
          apiBaseUrl={apiBaseUrl}
        />
      )}
    </div>
  )
}
