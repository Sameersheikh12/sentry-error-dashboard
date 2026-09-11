import type { AnalysisDiagnostics } from '@/lib/analysis/diagnose'
import { FAINT_TEXT, MUTED_TEXT } from './controls'
import { formatCount } from './format'

/**
 * A state that never appears is indistinguishable from a state whose detection is broken, so the
 * branch counts are on the page rather than left to be guessed at.
 */
export function DiagnosticsPanel({
  diagnostics,
  baselineHours,
}: {
  diagnostics: AnalysisDiagnostics
  baselineHours: number
}) {
  const entries: [string, string][] = [
    ['Issues scanned', formatCount(diagnostics.issuesScanned)],
    ['With events in window', formatCount(diagnostics.issuesWithCurrentEvents)],
    ['Baseline only (silent now)', formatCount(diagnostics.issuesBaselineOnly)],
    ['Baseline span', `${formatCount(Math.round(baselineHours))}h`],
    ['Loose clusters', formatCount(diagnostics.looseClusters)],
    ['Rows withheld (invariants)', formatCount(diagnostics.invariantViolations)],
  ]

  return (
    <details className="rounded-lg border border-slate-500/25">
      <summary className={`cursor-pointer list-none px-3 py-2 text-xs font-semibold uppercase tracking-wide ${MUTED_TEXT} hover:bg-slate-500/5`}>
        Diagnostics — state distribution and grouping
      </summary>

      <div className="space-y-3 px-3 pb-3 text-xs">
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          {entries.map(([label, value]) => (
            <span key={label}>
              <span className={FAINT_TEXT}>{label}: </span>
              <span className="tabular-nums font-medium">{value}</span>
            </span>
          ))}
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <span className={FAINT_TEXT}>Issue states:</span>
          {Object.entries(diagnostics.issueStateCounts).map(([state, count]) => (
            <span key={state} className="tabular-nums">
              {state} <span className="font-medium">{count}</span>
            </span>
          ))}
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <span className={FAINT_TEXT}>Grouped by:</span>
          {Object.entries(diagnostics.extractorCounts).map(([extractor, count]) => (
            <span key={extractor} className="tabular-nums">
              {extractor} <span className="font-medium">{count}</span>
            </span>
          ))}
        </div>

        {diagnostics.notes.length > 0 && (
          <ul className={`list-disc space-y-1 pl-4 ${MUTED_TEXT}`}>
            {diagnostics.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
