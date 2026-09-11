'use client'

import { useState } from 'react'
import { WINDOW_PRESETS } from '@/lib/config/analysis.config'
import { CUSTOM_WINDOW, type DashboardFilters } from '@/lib/dashboard/filters'
import {
  CONTROL_BUTTON,
  CONTROL_SELECT,
  FAINT_TEXT,
  PILL_ACTIVE,
  POPOVER_SURFACE,
  PILL_BASE,
  PILL_RESTING,
} from './controls'
import { useDismissable } from './useDismissable'

// datetime-local speaks "YYYY-MM-DDTHH:mm"; everything here stays in UTC so what you pick is
// what gets queried.
function toInputValue(date: Date | undefined): string {
  return date ? date.toISOString().slice(0, 16) : ''
}

export function WindowPicker({
  filters,
  windowLabel,
  earliestIso,
  onApply,
}: {
  filters: DashboardFilters
  windowLabel: string
  /** Sentry's retention floor, supplied by the server so no clock is read during render. */
  earliestIso?: string
  onApply: (changes: Partial<DashboardFilters>) => void
}) {
  const { containerRef, triggerRef, open, setOpen, close } = useDismissable<HTMLDivElement>()
  const [start, setStart] = useState(toInputValue(filters.start))
  const [end, setEnd] = useState(toInputValue(filters.end))
  const earliest = earliestIso ? earliestIso.slice(0, 16) : undefined

  const applyPreset = (token: string) => {
    onApply({ window: token, start: undefined, end: undefined })
    close(true)
  }

  // Sentry drops events past its retention, so a range starting earlier returns an empty result
  // that would read as "nothing is wrong" rather than "no data exists".
  const outOfRetention = Boolean(earliest && start && start < earliest)

  const applyCustom = () => {
    const from = new Date(`${start}:00Z`)
    const to = new Date(`${end}:00Z`)
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return
    if (from >= to || outOfRetention) return
    onApply({ window: CUSTOM_WINDOW, start: from, end: to })
    close(true)
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={CONTROL_BUTTON}
      >
        {windowLabel}
        <span aria-hidden className="text-xs">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Select time window"
          className={`absolute left-0 z-20 mt-1 w-72 space-y-3 p-3 ${POPOVER_SURFACE}`}
        >
          <div className="grid grid-cols-3 gap-1">
            {WINDOW_PRESETS.map((preset) => (
              <button
                key={preset.token}
                type="button"
                onClick={() => applyPreset(preset.token)}
                aria-pressed={filters.window === preset.token}
                className={`${PILL_BASE} justify-center ${
                  filters.window === preset.token ? PILL_ACTIVE : PILL_RESTING
                }`}
              >
                {preset.token}
              </button>
            ))}
          </div>

          <div className="space-y-2 border-t border-slate-500/25 pt-2">
            <p className={`text-[11px] font-semibold uppercase tracking-wide ${FAINT_TEXT}`}>
              Absolute range (UTC)
            </p>
            <label className="block text-xs">
              From
              <input
                type="datetime-local"
                value={start}
                min={earliest}
                onChange={(event) => setStart(event.target.value)}
                className={`${CONTROL_SELECT} mt-0.5 w-full`}
              />
            </label>
            <label className="block text-xs">
              To
              <input
                type="datetime-local"
                value={end}
                min={earliest}
                onChange={(event) => setEnd(event.target.value)}
                className={`${CONTROL_SELECT} mt-0.5 w-full`}
              />
            </label>
            {outOfRetention && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Sentry only holds events back to {earliest?.replace('T', ' ')} UTC.
              </p>
            )}
            <button
              type="button"
              onClick={applyCustom}
              disabled={!start || !end || outOfRetention}
              className={`${PILL_BASE} ${PILL_RESTING} w-full justify-center disabled:opacity-40`}
            >
              Apply range
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
