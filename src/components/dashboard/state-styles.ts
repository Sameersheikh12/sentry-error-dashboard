import type { IssueState } from '@/lib/analysis/types'

export interface StateStyle {
  label: string
  badge: string
  /** Fill for timeline segments; FADING reads reassuring because it means something improved. */
  fill: string
}

export const STATE_STYLES: Record<IssueState, StateStyle> = {
  NEW: {
    label: 'New',
    badge: 'bg-red-500/15 text-red-700 dark:text-red-300 ring-red-500/30',
    fill: 'fill-red-500',
  },
  REGRESSED: {
    label: 'Regressed',
    badge: 'bg-orange-500/15 text-orange-800 dark:text-orange-300 ring-orange-500/30',
    fill: 'fill-orange-500',
  },
  SURGING: {
    label: 'Surging',
    badge: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 ring-amber-500/30',
    fill: 'fill-amber-500',
  },
  CHRONIC: {
    label: 'Chronic',
    badge: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 ring-slate-500/25',
    fill: 'fill-slate-400',
  },
  FADING: {
    label: 'Fading',
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30',
    fill: 'fill-emerald-500',
  },
}
