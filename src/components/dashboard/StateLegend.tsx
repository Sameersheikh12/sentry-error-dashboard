import { FAINT_TEXT, MUTED_TEXT, REFERENCE_SURFACE } from './controls'
import { StateBadge } from './StateBadge'
import { baselineExplanation, stateRules, thresholdExplanation } from './state-rules'

/**
 * Says how every label on the page was decided. Collapsed by default — it answers a question you
 * only ask once — and generated from the live config, so it cannot describe a rule the code has
 * stopped applying.
 */
export function StateLegend() {
  return (
    <details className={`group ${REFERENCE_SURFACE}`}>
      <summary
        className={`cursor-pointer list-none px-3 py-2.5 text-sm ${MUTED_TEXT} hover:bg-slate-500/5`}
      >
        <span className="group-open:hidden">▸ </span>
        <span className="hidden group-open:inline">▾ </span>
        How these labels are decided
      </summary>

      <div className="space-y-3 px-3 pb-3">
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[6rem_minmax(0,1fr)]">
          {stateRules().map(({ state, rule, meaning }) => (
            <div key={state} className="contents">
              <dt className="pt-0.5">
                <StateBadge state={state} />
              </dt>
              <dd className="text-sm">
                {rule}
                <span className={`block text-xs ${FAINT_TEXT}`}>{meaning}</span>
              </dd>
            </div>
          ))}
        </dl>

        <p className={`border-t border-slate-500/20 pt-3 text-xs ${MUTED_TEXT}`}>
          {baselineExplanation()}
        </p>
        <p className={`text-xs ${MUTED_TEXT}`}>{thresholdExplanation()}</p>
      </div>
    </details>
  )
}
