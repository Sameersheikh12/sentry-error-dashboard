import type { AnalyzedIssue, Problem } from '@/lib/analysis/types'
import { isRateDecrease } from '@/lib/analysis/score'
import { clampText, safeSentryLink } from '@/lib/dashboard/safe-link'
import {
  CELL_RATE,
  CHIP_INFO,
  CHIP_WARN,
  CELL_USERS,
  CELL_WIDE,
  FAINT_TEXT,
  MUTED_TEXT,
  NUMERIC_CELL,
  ROW_GRID,
  ROW_HOVER,
} from './controls'
import { formatAgo, formatCount, formatMultiplier } from './format'
import { Sparkline } from './Sparkline'
import { StateBadge } from './StateBadge'

const MAX_TITLE = 140
const MAX_KEY = 110

function Chip({ tone, children }: { tone: 'info' | 'warn'; children: React.ReactNode }) {
  const styles = tone === 'warn' ? CHIP_WARN : CHIP_INFO
  return (
    <span className={`ml-2 rounded border px-1 py-px text-[10px] font-medium ${styles}`}>
      {children}
    </span>
  )
}

function RateCell({ multiplier, className }: { multiplier: number | null; className: string }) {
  // A rate that fell is not something to act on, so it reads quietly rather than competing with
  // a surge for attention.
  const tone =
    multiplier === null
      ? FAINT_TEXT
      : isRateDecrease(multiplier)
        ? `${FAINT_TEXT} font-normal`
        : 'font-medium'

  return (
    <span className={`${className} ${NUMERIC_CELL} text-sm ${tone}`}>
      {isRateDecrease(multiplier) && <span aria-hidden>↓ </span>}
      {formatMultiplier(multiplier)}
    </span>
  )
}

function IssueLink({ issue, apiBaseUrl }: { issue: AnalyzedIssue; apiBaseUrl: string }) {
  const href = safeSentryLink(issue.snapshot.permalink, apiBaseUrl)
  const label = <span className="font-mono text-xs">{issue.snapshot.shortId}</span>

  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
      {label}
    </a>
  ) : (
    label
  )
}

function Cells({ problem }: { problem: Problem }) {
  const isGroup = problem.issues.length > 1
  return (
    <>
      <span
        className={`${CELL_USERS} ${NUMERIC_CELL} text-sm`}
        title={
          isGroup
            ? 'At least this many: Sentry counts users per issue and cannot de-duplicate across a group'
            : 'Users affected in the selected window'
        }
      >
        {isGroup ? '≥' : ''}
        {formatCount(problem.aggregate.userCount)}
      </span>
      <span className={`${NUMERIC_CELL} text-sm`}>
        {formatCount(problem.aggregate.currentEvents)}
      </span>
      <RateCell multiplier={problem.aggregate.surgeMultiplier} className={CELL_RATE} />
    </>
  )
}

/** One member: one row. A group header plus a single identical child conveys nothing extra. */
function SingletonRow({
  problem,
  now,
  apiBaseUrl,
}: {
  problem: Problem
  now: number
  apiBaseUrl: string
}) {
  const issue = problem.issues[0]

  return (
    <div className={`${ROW_GRID} border-b border-slate-500/15 py-2.5 ${ROW_HOVER}`}>
      <StateBadge state={problem.state} />
      <span className="min-w-0">
        <span className="block truncate font-mono text-sm">
          {clampText(problem.key, MAX_KEY)}
          <span className={`ml-2 font-sans text-xs ${FAINT_TEXT}`}>
            <IssueLink issue={issue} apiBaseUrl={apiBaseUrl} />
          </span>
        </span>
        <span className={`block truncate text-xs ${MUTED_TEXT}`}>{problem.reason}</span>
      </span>
      <Cells problem={problem} />
      <span className={`${CELL_WIDE} ${FAINT_TEXT}`}>
        <Sparkline buckets={problem.buckets} />
      </span>
      <span className={`${CELL_WIDE} ${NUMERIC_CELL} text-xs ${FAINT_TEXT}`}>
        {formatAgo(problem.aggregate.lastSeen, now)}
      </span>
    </div>
  )
}

export function ProblemRow({
  problem,
  now,
  apiBaseUrl,
}: {
  problem: Problem
  now: number
  apiBaseUrl: string
}) {
  if (problem.issues.length === 1) {
    return <SingletonRow problem={problem} now={now} apiBaseUrl={apiBaseUrl} />
  }

  return (
    <details className="group border-b border-slate-500/15">
      <summary className={`${ROW_GRID} cursor-pointer py-2.5 ${ROW_HOVER}`}>
        <StateBadge state={problem.state} />
        <span className="min-w-0">
          <span className="block truncate font-mono text-sm">
            {clampText(problem.key, MAX_KEY)}
            <span className={`ml-2 font-sans text-xs ${FAINT_TEXT}`}>
              {problem.issues.length} issues
            </span>
            {problem.hasNewVariant && <Chip tone="info">new variant</Chip>}
            {problem.looseGrouping && <Chip tone="warn">loose grouping</Chip>}
          </span>
          <span className={`block truncate text-xs ${MUTED_TEXT}`}>{problem.reason}</span>
        </span>
        <Cells problem={problem} />
        <span className={`${CELL_WIDE} ${FAINT_TEXT}`}>
          <Sparkline buckets={problem.buckets} />
        </span>
        <span className={`${CELL_WIDE} ${NUMERIC_CELL} text-xs ${FAINT_TEXT}`}>
          {formatAgo(problem.aggregate.lastSeen, now)}
        </span>
      </summary>

      <div className="bg-slate-500/[0.04] px-3 py-2">
        <p className={`mb-2 text-xs ${FAINT_TEXT}`}>
          Grouped by <span className="font-mono">{problem.extractor}</span>
          {problem.looseGrouping && ' — members share no wording beyond the key'}
        </p>

        <div className="divide-y divide-slate-500/10">
          {problem.issues.map((issue) => (
            <div key={issue.snapshot.id} className={`${ROW_GRID} py-1.5 text-xs`}>
              <StateBadge state={issue.state} />
              <span className="min-w-0 truncate">
                {clampText(issue.snapshot.title, MAX_TITLE)}
                <span className={`ml-2 ${FAINT_TEXT}`}>
                  <IssueLink issue={issue} apiBaseUrl={apiBaseUrl} />
                </span>
              </span>
              <span className={`${CELL_USERS} ${NUMERIC_CELL}`}>
                {formatCount(issue.snapshot.userCount)}
              </span>
              <span className={NUMERIC_CELL}>{formatCount(issue.snapshot.currentEvents)}</span>
              <RateCell multiplier={issue.aggregate.surgeMultiplier} className={CELL_RATE} />
              <span className={`${CELL_WIDE} ${FAINT_TEXT}`}>
                <Sparkline buckets={issue.snapshot.buckets} />
              </span>
              <span className={`${CELL_WIDE} ${NUMERIC_CELL} ${FAINT_TEXT}`}>
                {formatAgo(issue.snapshot.lastSeen, now)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </details>
  )
}
