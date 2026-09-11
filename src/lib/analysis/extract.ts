import { normalizeCulprit } from './normalize'
import type { GroupingExtractor, IssueSnapshot } from './types'

export interface GroupingSignature {
  key: string
  extractor: GroupingExtractor
}

export interface ExtractorOptions {
  extractors: readonly GroupingExtractor[]
  /**
   * Type names that wrap many unrelated failures. "PWA Journey API Error" is the same string on
   * every API failure in a project, so grouping on it collapses everything that project cares
   * about into one heap.
   */
  wrapperPrefixes: readonly string[]
  /** Type names that carry no discriminating signal, e.g. a bare "Error". */
  genericTypeNames: readonly string[]
}

// A path is only a path when something other than a scheme or another slash precedes it, so
// "https://host/x" inside a title does not read as the route "//host/x".
const API_PATH = /(?<![:\w/])(\/[A-Za-z0-9_\-:.{}/]+)/

/**
 * The discriminating signal in a wrapped error is the endpoint named in its title, not the
 * culprit — the culprit is only the page the user was on when it failed.
 */
export function extractApiPath(title: string): string | null {
  const match = API_PATH.exec(title)
  if (!match) return null

  const normalized = normalizeCulprit(match[1])
  if (!normalized) return null

  // "/:id" discriminates nothing — every id-only path in the project would land in one bucket.
  const hasLiteralSegment = normalized
    .split('/')
    .some((segment) => segment.length > 0 && !segment.startsWith(':'))

  return hasLiteralSegment ? normalized : null
}

/**
 * A grouping key has to discriminate. A wrapper prefix is the same string on every failure in a
 * project, and a bare "Error" says nothing at all — both produce garbage buckets, so both fall
 * through to the next extractor rather than forming a cluster.
 */
export function extractExceptionType(
  exceptionType: string | null,
  wrapperPrefixes: readonly string[],
  genericTypeNames: readonly string[],
): string | null {
  const trimmed = exceptionType?.trim()
  if (!trimmed) return null

  const lowered = trimmed.toLowerCase()
  if (genericTypeNames.some((name) => name.trim().toLowerCase() === lowered)) return null

  const isWrapper = wrapperPrefixes.some((prefix) => {
    const candidate = prefix.trim().toLowerCase()
    return candidate.length > 0 && lowered.startsWith(candidate)
  })

  return isWrapper ? null : trimmed
}

function runExtractor(
  extractor: GroupingExtractor,
  snapshot: IssueSnapshot,
  options: ExtractorOptions,
): string | null {
  switch (extractor) {
    case 'api-path':
      return extractApiPath(snapshot.title)
    case 'exception-type':
      return extractExceptionType(
        snapshot.exceptionType,
        options.wrapperPrefixes,
        options.genericTypeNames,
      )
    case 'normalized-culprit':
      return normalizeCulprit(snapshot.culprit)
    case 'issue-id':
      return snapshot.id
  }
}

/** First extractor to yield a key wins; the issue id is the terminal fallback. */
export function groupingSignature(
  snapshot: IssueSnapshot,
  options: ExtractorOptions,
): GroupingSignature {
  for (const extractor of options.extractors) {
    const key = runExtractor(extractor, snapshot, options)?.trim()
    if (key) return { key, extractor }
  }

  return { key: snapshot.id, extractor: 'issue-id' }
}
