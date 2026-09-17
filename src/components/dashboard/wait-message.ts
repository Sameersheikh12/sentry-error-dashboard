/**
 * What to say while an agent run is in flight.
 *
 * An agent turn is tens of seconds, and a single unchanging line for seventy of them reads as a
 * hung page. What this does NOT do is invent progress: the CLI reports nothing until it finishes,
 * so there are no real steps to show, and a fake "now searching events…" would be a lie told to
 * make a spinner feel busier.
 *
 * Instead the elapsed count is real, and the wording changes at thresholds to say what is normal
 * and when it stops being normal — which is the thing a waiting reader actually wants to know:
 * is this still working, and should I worry yet?
 */
export type WaitKind = 'sweep' | 'add' | 'ask'

export interface WaitCopy {
  text: string
  /** True once the wait has run past what is typical, so the UI can mark it. */
  slow: boolean
}

/** Past this, the run is slower than measured runs of the same shape. */
const SLOW_AFTER_SECONDS = 75

const OPENING: Record<WaitKind, string> = {
  sweep: 'Opening the top events',
  add: 'Opening those events',
  ask: 'Looking this up in Sentry',
}

const WORKING: Record<WaitKind, string> = {
  sweep: 'Reading what the errors actually say',
  add: 'Reading what those errors actually say',
  ask: 'Searching Sentry and reading the events',
}

const STILL: Record<WaitKind, string> = {
  sweep: 'Still reading — each problem is its own Sentry lookup',
  add: 'Still reading — each problem is its own Sentry lookup',
  ask: 'Still going — a follow-up usually needs a few lookups',
}

export function waitCopy(kind: WaitKind, elapsedSeconds: number, timeoutSeconds: number): WaitCopy {
  const seconds = Math.max(0, Math.floor(elapsedSeconds))

  // Before the first few seconds a count is noise, and the run may yet come back from cache.
  if (seconds < 4) return { text: `${OPENING[kind]}…`, slow: false }

  if (seconds >= SLOW_AFTER_SECONDS) {
    return {
      text: `Slower than usual — ${seconds}s of up to ${timeoutSeconds}s before this gives up.`,
      slow: true,
    }
  }

  if (seconds >= 30) return { text: `${STILL[kind]}… ${seconds}s`, slow: false }

  return { text: `${WORKING[kind]}… ${seconds}s`, slow: false }
}
