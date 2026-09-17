'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { IssueState } from '@/lib/analysis/types'
import type { AgentProblem, AgentResult } from '@/lib/agent/analyze'
import { CONTROL_SELECT_SMALL, FAINT_TEXT, MUTED_TEXT, PILL_BASE, PILL_RESTING } from './controls'
import { waitCopy } from './wait-message'
import { AskThread } from './AskThread'
import { StateBadge } from './StateBadge'

type Phase = 'running' | 'done' | 'error'

interface Candidate {
  key: string
  state: IssueState
}

/**
 * The local Claude agent's reading of the ranked problems.
 *
 * Everything else on the page is arithmetic over issue metadata. This is the one panel that has
 * opened an event, so it leads with the upstream error — the field the title hides and that no
 * amount of aggregation can recover.
 *
 * It runs on load and is cached per view, so refreshing costs nothing and changing a filter buys a
 * fresh analysis.
 */
export function AgentPanel({
  query,
  models,
  efforts,
  defaultModel,
  defaultEffort,
  timeoutSeconds,
}: {
  query: string
  models: readonly string[]
  efforts: readonly string[]
  defaultModel: string
  defaultEffort: string
  timeoutSeconds: number
}) {
  // The page gives this component a key derived from the view, so changing a filter remounts it
  // and the state starts clean — no resetting from inside an effect.
  const [phase, setPhase] = useState<Phase>('running')
  const [result, setResult] = useState<AgentResult | null>(null)
  const [message, setMessage] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [attempt, setAttempt] = useState(0)
  // Deliberately not in the URL: these change who answers, not what is shown, and the ranking below
  // is identical either way. Keeping them local means switching costs no page load and no refetch
  // of Sentry. A reload returns to the cheap default, which is the right way round for a cost knob.
  const [model, setModel] = useState(defaultModel)
  const [effort, setEffort] = useState(defaultEffort)
  // Problems the ranking holds, whether or not they have been read yet.
  const [candidates, setCandidates] = useState<Candidate[]>([])
  // Ticked in the picker but not yet submitted, so several can go in one run.
  const [selected, setSelected] = useState<string[]>([])
  // Being read right now. These render as placeholder rows under the finished ones.
  const [pending, setPending] = useState<Candidate[]>([])
  const [addMessage, setAddMessage] = useState('')

  /**
   * Problems added beyond the sweep, in a ref rather than state.
   *
   * They belong in the request URL but must not be an effect dependency: if they were, adding one
   * would re-run the sweep effect, which clears the panel — the finished findings would vanish
   * for half a minute while one new problem was read.
   */
  const addedRef = useRef<string[]>([])

  const urlFor = useCallback(
    (keys: string[]) =>
      `${query}&model=${model}&effort=${effort}` +
      (keys.length > 0 ? `&add=${keys.map(encodeURIComponent).join(',')}` : ''),
    [query, model, effort],
  )

  /**
   * Bumped on every reset — a full sweep, a model/effort switch, or Re-analyse. Any in-flight
   * request (the sweep's own load, or a multi-select add still being read) that started under an
   * earlier generation checks this before writing to state, so a slow response that has been
   * superseded is discarded rather than overwriting whatever the newer action produced. Without
   * this, clicking Re-analyse while an add was still in flight could let the add's response land
   * after the reanalyse and silently replace its result with stale content.
   */
  const generationRef = useRef(0)

  const reset = useCallback(() => {
    generationRef.current += 1
    setPhase('running')
    setResult(null)
    setMessage('')
    setAddMessage('')
    setElapsed(0)
    setPending([])
    setSelected([])
  }, [])

  /**
   * Skips this component's own peek, so it always asks the server to do real work rather than
   * accept a cached answer without trying. It is not a guarantee of spending, though: if another
   * request for this exact view is already in flight — an add still being read, say — the server
   * waits for that first and can end up serving this for free too, which is the correct outcome
   * (the fresh work it wanted is happening either way) rather than a second paid duplicate of it.
   */
  const reanalyse = useCallback(() => {
    reset()
    setAttempt((n) => n + 1)
  }, [reset])

  /**
   * Switching model or effort peeks the cache first, so comparing two models costs one run each
   * and flipping between them afterwards is free. Anything already added stays added, and is
   * re-read on the new model.
   */
  const choose = useCallback(
    (next: () => void) => {
      reset()
      setAttempt(0)
      next()
    },
    [reset],
  )

  useEffect(() => {
    let cancelled = false
    const generation = generationRef.current

    // A reset (reanalyse, model/effort switch) bumps the generation. If one happens while this
    // load is in flight, its response is stale by the time it lands and must not be applied — the
    // local `cancelled` flag alone only protects against this effect re-running, not against a
    // multi-select add (a separate async flow entirely) racing it from the other direction.
    const stale = () => cancelled || generationRef.current !== generation

    const load = async () => {
      const url = urlFor(addedRef.current)

      // Ask for a cached answer first; only spend if there is not one for this exact view.
      // A deliberate re-analysis skips the peek, which is the whole point of the button.
      if (attempt === 0) {
        const peek = await fetch(`/api/agent?${url}&peek=1`).then((r) => r.json())
        if (stale()) return
        if (peek.candidates) setCandidates(peek.candidates)
        if (peek.result) {
          setResult(peek.result)
          setPhase('done')
          return
        }
      }

      const response = await fetch(`/api/agent?${url}`)
      const body = await response.json()
      if (stale()) return
      if (body.candidates) setCandidates(body.candidates)

      if (!response.ok || body.error) {
        setMessage(body.error?.message ?? 'The agent could not complete the analysis.')
        setPhase('error')
        return
      }
      if (!body.result) {
        setMessage(body.skipped ?? 'Nothing to explain in this view.')
        setPhase('error')
        return
      }
      setResult(body.result)
      setPhase('done')
    }

    load().catch((error: unknown) => {
      if (stale()) return
      setMessage(error instanceof Error ? error.message : 'The agent could not be reached.')
      setPhase('error')
    })

    return () => {
      cancelled = true
    }
  }, [urlFor, attempt])

  const toggle = useCallback((key: string) => {
    setSelected((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    )
  }, [])

  /**
   * Read every selected problem in one run.
   *
   * One run rather than one per problem: a run has fixed overhead whatever it covers, so three
   * together cost less and finish in one wait instead of three. The finished findings stay on
   * screen throughout — the new ones appear as placeholders underneath and fill in — so there is
   * something to read while this is happening.
   */
  const readSelected = useCallback(async () => {
    if (selected.length === 0 || pending.length > 0) return

    const generation = generationRef.current
    const keys = selected
    const rows = candidates.filter((candidate) => keys.includes(candidate.key))
    const before = addedRef.current
    addedRef.current = [...before, ...keys.filter((key) => !before.includes(key))]

    setPending(rows)
    setSelected([])
    setAddMessage('')

    try {
      const response = await fetch(`/api/agent?${urlFor(addedRef.current)}`)
      const body = await response.json()
      // A reset (reanalyse, or switching model/effort) started a newer, unrelated request while
      // this one was in flight — that request owns `result` now, so this response is discarded
      // rather than clobbering it. `addedRef` is left alone: the newer request already read it
      // when it started and will include these same keys on its own.
      if (generationRef.current !== generation) return

      if (!response.ok || body.error) {
        addedRef.current = before
        setAddMessage(body.error?.message ?? 'Those problems could not be read.')
        return
      }
      if (body.candidates) setCandidates(body.candidates)
      if (body.result) setResult(body.result)
    } catch (error: unknown) {
      if (generationRef.current !== generation) return
      addedRef.current = before
      setAddMessage(error instanceof Error ? error.message : 'The agent could not be reached.')
    } finally {
      if (generationRef.current === generation) setPending([])
    }
  }, [candidates, pending.length, selected, urlFor])

  useEffect(() => {
    if (phase !== 'running') return
    const tick = setInterval(() => setElapsed((seconds) => seconds + 1), 1000)
    return () => clearInterval(tick)
  }, [phase])

  const read = result?.analysis.problems.map((problem) => problem.key) ?? []
  const unread = candidates.filter(
    (candidate) =>
      !read.includes(candidate.key) && !pending.some((row) => row.key === candidate.key),
  )

  return (
    <section className="rounded-lg border border-blue-500/40 bg-blue-500/[0.04]">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-blue-500/25 px-4 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
          Read by local Claude over Sentry MCP
        </h2>
        <div className={`flex items-center gap-2 text-[11px] tabular-nums ${FAINT_TEXT}`}>
          <label className="flex items-center gap-1">
            <span className="sr-only">Model</span>
            <select
              className={CONTROL_SELECT_SMALL}
              value={model}
              onChange={(event) => choose(() => setModel(event.target.value))}
              title="Which model reads the events. Bigger is slower and costs more; on this task it rarely reads better."
            >
              {models.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="sr-only">Effort</span>
            <select
              className={CONTROL_SELECT_SMALL}
              value={effort}
              onChange={(event) => choose(() => setEffort(event.target.value))}
              title="How hard the model thinks before answering."
            >
              {efforts.map((name) => (
                <option key={name} value={name}>
                  {name} effort
                </option>
              ))}
            </select>
          </label>
          {pending.length > 0 && (
            <span role="status">
              reading {pending.length} more…
            </span>
          )}
          {result && pending.length === 0 && (
            <span>
              {result.cached
                ? 'cached'
                : `${result.analysedNow} read${result.fromCache > 0 ? ` · ${result.fromCache} cached` : ''} · ${Math.round(result.durationMs / 1000)}s · $${result.costUsd.toFixed(3)}`}
            </span>
          )}
          {phase !== 'running' && (
            <button
              type="button"
              onClick={reanalyse}
              className="cursor-pointer rounded border border-blue-500/40 px-1.5 py-0.5 font-medium text-blue-700 transition-colors hover:bg-blue-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:text-blue-300"
            >
              Re-analyse
            </button>
          )}
        </div>
      </header>

      <div className="px-4 py-3">
        {phase === 'running' && <SweepWait elapsed={elapsed} timeoutSeconds={timeoutSeconds} />}

        {phase === 'error' && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {message} The ranking below is unaffected — it is computed without the agent.
          </p>
        )}

        {phase === 'done' && result && (
          <>
            {/* The verdict is the answer, so it never collapses. */}
            <p className="text-[15px] font-medium leading-snug">{result.analysis.verdict}</p>

            <ul className="mt-3 space-y-2">
              {result.analysis.problems.map((problem) => (
                <li key={problem.key}>
                  <Finding
                    problem={problem}
                    query={query}
                    model={model}
                    effort={effort}
                    timeoutSeconds={timeoutSeconds}
                  />
                </li>
              ))}
              {/* Placeholders sit below the finished findings, never in place of them. */}
              {pending.map((row) => (
                <li key={`pending:${row.key}`}>
                  <Reading candidate={row} />
                </li>
              ))}
            </ul>

            {addMessage && (
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-300" role="alert">
                {addMessage} The findings above are unaffected.
              </p>
            )}

            <Unread
              unread={unread}
              selected={selected}
              busy={pending.length > 0}
              onToggle={toggle}
              onRead={readSelected}
            />

            {result.analysis.notes.length > 0 && (
              <details className="group mt-2">
                <summary
                  className={`cursor-pointer list-none rounded px-1 py-1 text-xs ${FAINT_TEXT} hover:bg-blue-500/5`}
                >
                  <span className="group-open:hidden">▸ </span>
                  <span className="hidden group-open:inline">▾ </span>
                  {result.analysis.notes.length} caveat
                  {result.analysis.notes.length === 1 ? '' : 's'} worth knowing
                </summary>
                <ul className={`mt-1 list-disc space-y-1 pl-6 text-xs ${FAINT_TEXT}`}>
                  {result.analysis.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  )
}

/** The wait for the sweep, which is the only time this panel has nothing to show yet. */
function SweepWait({ elapsed, timeoutSeconds }: { elapsed: number; timeoutSeconds: number }) {
  const copy = waitCopy('sweep', elapsed, timeoutSeconds)

  return (
    <p
      className={`flex items-center gap-2 text-sm ${copy.slow ? 'text-amber-700 dark:text-amber-300' : MUTED_TEXT}`}
      role="status"
    >
      <span
        aria-hidden
        className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-blue-500"
      />
      {copy.text}
    </p>
  )
}

/** A problem currently being read, in the place its finding will occupy. */
function Reading({ candidate }: { candidate: Candidate }) {
  return (
    <div className="rounded border border-dashed border-blue-500/30 bg-background px-2.5 py-2">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StateBadge state={candidate.state} />
        <span className={`font-mono text-[11px] ${MUTED_TEXT}`}>{candidate.key}</span>
      </span>
      <span
        className={`mt-1 flex items-center gap-1.5 text-[13px] ${FAINT_TEXT}`}
        role="status"
      >
        <span aria-hidden className="inline-block size-1.5 animate-pulse rounded-full bg-blue-500" />
        reading the event…
      </span>
    </div>
  )
}

/**
 * The problems the ranking holds that nobody has read yet.
 *
 * The sweep reads the top few, because each one is an MCP round-trip and reading twenty on load
 * would be slow and expensive for a page you might only glance at. That leaves the rest
 * unexplained, which is fine as a default and wrong as a dead end.
 *
 * They are picked as a set rather than one at a time: a run has fixed overhead whatever it covers,
 * so reading three together is cheaper than three runs and takes one wait instead of three.
 */
function Unread({
  unread,
  selected,
  busy,
  onToggle,
  onRead,
}: {
  unread: Candidate[]
  selected: string[]
  busy: boolean
  onToggle: (key: string) => void
  onRead: () => void
}) {
  if (unread.length === 0) return null

  return (
    <details className="group mt-3" open={selected.length > 0}>
      <summary
        className={`cursor-pointer list-none rounded px-1 py-1 text-xs ${FAINT_TEXT} hover:bg-blue-500/5`}
      >
        <span className="group-open:hidden">▸ </span>
        <span className="hidden group-open:inline">▾ </span>
        {unread.length} more ranked problem{unread.length === 1 ? '' : 's'} not read yet — pick any
        to analyse together
      </summary>

      <div className="mt-1.5 pl-5">
        <ul className="flex flex-wrap gap-1.5">
          {unread.map((candidate) => {
            const ticked = selected.includes(candidate.key)
            return (
              <li key={candidate.key}>
                <button
                  type="button"
                  aria-pressed={ticked}
                  onClick={() => onToggle(candidate.key)}
                  title={`${ticked ? 'Remove' : 'Select'} ${candidate.key}`}
                  className={`${PILL_BASE} ${ticked ? 'border-blue-600 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-400 dark:text-slate-900' : PILL_RESTING} max-w-[22rem]`}
                >
                  <span aria-hidden className={ticked ? '' : 'opacity-0'}>
                    ✓
                  </span>
                  <StateBadge state={candidate.state} />
                  <span className="truncate font-mono">{candidate.key}</span>
                </button>
              </li>
            )
          })}
        </ul>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRead}
            disabled={selected.length === 0 || busy}
            className={`${PILL_BASE} ${PILL_RESTING}`}
          >
            {busy && 'Reading…'}
            {!busy && selected.length === 0 && 'Read selected problems'}
            {!busy &&
              selected.length > 0 &&
              `Read ${selected.length} selected problem${selected.length === 1 ? '' : 's'}`}
          </button>
          {selected.length > 1 && (
            <span className={`text-[11px] ${FAINT_TEXT}`}>
              one run for all {selected.length} — cheaper and faster than one at a time
            </span>
          )}
        </div>
      </div>
    </details>
  )
}

/**
 * One problem the agent opened.
 *
 * The upstream error stays visible because it is the reason this panel exists — it is the field
 * the title hides, and three of them should be scannable in three lines. The interpretation is a
 * paragraph, so it collapses; reading it is a decision, not something to wade through.
 */
function Finding({
  problem,
  query,
  model,
  effort,
  timeoutSeconds,
}: {
  problem: AgentProblem
  query: string
  model: string
  effort: string
  timeoutSeconds: number
}) {
  const [asking, setAsking] = useState(false)

  return (
    <details className="group rounded border border-blue-500/25 bg-background">
      <summary className="cursor-pointer list-none rounded px-2.5 py-2 hover:bg-blue-500/[0.06]">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StateBadge state={problem.state} />
          <span className={`font-mono text-[11px] ${MUTED_TEXT}`}>{problem.key}</span>
          <span className={`ml-auto text-[11px] ${MUTED_TEXT}`}>
            <span className="group-open:hidden">▸ what this means</span>
            <span className="hidden group-open:inline">▾ what this means</span>
          </span>
        </span>
        {problem.rootCause ? (
          <span className="mt-1 block break-words font-mono text-[13px] font-medium text-blue-800 dark:text-blue-200">
            {problem.rootCause}
          </span>
        ) : (
          <span className={`mt-1 block text-[13px] italic ${FAINT_TEXT}`}>
            the event carries no upstream error
          </span>
        )}
      </summary>
      <div className="border-t border-blue-500/20">
        <p className={`px-2.5 py-2 text-sm leading-snug ${MUTED_TEXT}`}>{problem.plainEnglish}</p>
        {asking ? (
          <AskThread
            problem={problem}
            query={query}
            model={model}
            effort={effort}
            timeoutSeconds={timeoutSeconds}
          />
        ) : (
          <div className="px-2.5 pb-2">
            <button
              type="button"
              onClick={() => setAsking(true)}
              className={`${PILL_BASE} ${PILL_RESTING}`}
            >
              Ask about this error
            </button>
          </div>
        )}
      </div>
    </details>
  )
}
