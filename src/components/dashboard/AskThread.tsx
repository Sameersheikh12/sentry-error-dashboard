'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentProblem } from '@/lib/agent/analyze'
import type { AskTurn } from '@/lib/agent/ask'
import { CONTROL_SELECT, FAINT_TEXT, MUTED_TEXT, PILL_BASE, PILL_RESTING } from './controls'
import { waitCopy } from './wait-message'

/**
 * The wait for one follow-up.
 *
 * Carries a real elapsed count, wording that changes as the wait lengthens, and a way out — a
 * question asked by mistake should not cost seventy seconds of staring at it.
 */
function Waiting({
  elapsed,
  timeoutSeconds,
  onCancel,
}: {
  elapsed: number
  timeoutSeconds: number
  onCancel: () => void
}) {
  const copy = waitCopy('ask', elapsed, timeoutSeconds)

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        aria-hidden
        className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-blue-500"
      />
      <p
        className={`text-sm ${copy.slow ? 'text-amber-700 dark:text-amber-300' : MUTED_TEXT}`}
        role="status"
      >
        {copy.text}
      </p>
      <button
        type="button"
        onClick={onCancel}
        className={`cursor-pointer text-[11px] underline underline-offset-2 ${FAINT_TEXT} transition-colors hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:hover:text-blue-300`}
      >
        Cancel
      </button>
    </div>
  )
}

const SUGGESTIONS = [
  'Which users are hitting this?',
  'When did this start, and what changed?',
  'Is this the same as the other problems here?',
]

/**
 * A follow-up conversation about one problem.
 *
 * Scoped on purpose. The panel above answers "what does this error say"; the obvious next
 * questions — who is affected, when did it start, is it the same as that other one — all need
 * Sentry to be read again, which is exactly what the agent can do and the computed layer cannot.
 * Everything already established is sent along, so a follow-up does not pay to rediscover it.
 */
export function AskThread({
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
  const [turns, setTurns] = useState<AskTurn[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // A follow-up is tens of seconds. Asking the wrong thing should not mean waiting it out.
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!busy) return
    const tick = setInterval(() => setElapsed((seconds) => seconds + 1), 1000)
    return () => clearInterval(tick)
  }, [busy])

  const ask = useCallback(
    async (text: string) => {
      const asked = text.trim()
      if (!asked || busy) return

      const history = turns
      setTurns([...history, { role: 'user', text: asked }])
      setQuestion('')
      setError('')
      setElapsed(0)
      setBusy(true)
      const controller = new AbortController()
      abortRef.current = controller

      /** A question that got no answer is rolled back, so retrying does not resend it as context. */
      const rollback = () => {
        setTurns(history)
        setQuestion(asked)
      }

      try {
        const response = await fetch(`/api/agent/ask?${query}`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            key: problem.key,
            state: problem.state,
            issueIds: problem.issueIds,
            rootCause: problem.rootCause,
            plainEnglish: problem.plainEnglish,
            question: asked,
            history,
            model,
            effort,
          }),
        })
        const body = await response.json()

        if (!response.ok || body.error) {
          setError(body.error?.message ?? 'The agent could not answer that.')
          rollback()
          return
        }
        setTurns((current) => [...current, { role: 'agent', text: body.result.answer }])
      } catch (cause) {
        // A cancel is a choice, not a failure: put the question back and say nothing more.
        if (cause instanceof DOMException && cause.name === 'AbortError') rollback()
        else {
          setError(cause instanceof Error ? cause.message : 'The agent could not be reached.')
          rollback()
        }
      } finally {
        abortRef.current = null
        setBusy(false)
        // The input is disabled while the question is in flight, which blurs it. Without this the
        // caret is gone by the time the answer lands and the next question needs a mouse.
        requestAnimationFrame(() => inputRef.current?.focus())
      }
    },
    [busy, effort, model, problem, query, turns],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clear = useCallback(() => {
    setTurns([])
    setError('')
    setQuestion('')
    inputRef.current?.focus()
  }, [])

  return (
    <div className="border-t border-blue-500/20 px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className={`text-[11px] ${FAINT_TEXT}`}>
          Asking about <span className="font-mono">{problem.key}</span> only
        </p>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className={`cursor-pointer text-[11px] underline underline-offset-2 ${FAINT_TEXT} transition-colors hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:hover:text-blue-300`}
          >
            Clear conversation
          </button>
        )}
      </div>

      {turns.length > 0 && (
        <ol className="mt-2 space-y-2">
          {turns.map((turn, index) => (
            <li key={`${turn.role}:${index}`} className="text-sm leading-snug">
              {turn.role === 'user' ? (
                <p className="font-medium">{turn.text}</p>
              ) : (
                <p className={`border-l-2 border-blue-500/40 pl-2 ${MUTED_TEXT}`}>{turn.text}</p>
              )}
            </li>
          ))}
        </ol>
      )}

      {busy && <Waiting elapsed={elapsed} timeoutSeconds={timeoutSeconds} onCancel={cancel} />}

      {error && (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-300" role="alert">
          {error} Your question is still in the box — press Ask to try again.
        </p>
      )}

      {turns.length === 0 && !busy && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => ask(suggestion)}
              className={`${PILL_BASE} ${PILL_RESTING}`}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          ask(question)
        }}
      >
        <input
          ref={inputRef}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask a follow-up about this error…"
          aria-label={`Ask a follow-up about ${problem.key}`}
          disabled={busy}
          className={`${CONTROL_SELECT} min-w-0 flex-1`}
        />
        <button
          type="submit"
          disabled={busy || question.trim() === ''}
          className={`${PILL_BASE} ${PILL_RESTING}`}
        >
          Ask
        </button>
      </form>
    </div>
  )
}
