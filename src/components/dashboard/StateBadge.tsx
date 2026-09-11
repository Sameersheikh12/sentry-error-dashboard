import type { IssueState } from '@/lib/analysis/types'
import { STATE_STYLES } from './state-styles'

export function StateBadge({ state }: { state: IssueState }) {
  const { label, badge } = STATE_STYLES[state]

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${badge}`}
    >
      {label}
    </span>
  )
}
