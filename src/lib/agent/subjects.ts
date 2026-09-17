import type { AgentSubject } from './analyze'

export interface ResolvedSubjects {
  subjects: AgentSubject[]
  /** A sweep forms the verdict; an add-run only contributes findings. */
  mode: 'sweep' | 'add'
}

/**
 * Decides which problems an agent request may cover.
 *
 * The sweep takes the top of the ranking. Anything else has to be named, and is resolved against
 * that same ranking rather than taken from the query string — a caller cannot invent a problem,
 * name one that is not on this page, or ask for the same one twice to pay for it twice.
 */
export function resolveSubjects(
  ranked: AgentSubject[],
  requestedKeys: string[],
  maxSubjects: number,
): ResolvedSubjects {
  const sweep = ranked.slice(0, maxSubjects)
  const already = new Set(sweep.map((subject) => subject.key))
  const added: AgentSubject[] = []

  for (const key of requestedKeys) {
    if (already.has(key)) continue
    const match = ranked.find((subject) => subject.key === key)
    if (!match) continue
    already.add(key)
    added.push(match)
  }

  return {
    subjects: [...sweep, ...added],
    mode: added.length > 0 ? 'add' : 'sweep',
  }
}

/** Splits a comma-separated `add` parameter into keys, tolerating spacing and empties. */
export function parseRequestedKeys(raw: string | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)
}
