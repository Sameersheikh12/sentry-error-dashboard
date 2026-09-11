const HTTP_METHOD = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/
const DIGITS_ONLY = /^\d+$/
const HEX_ONLY = /^[0-9a-f]+$/i

/**
 * A hex run needs a digit in it before we treat it as an identifier: eight or more hex
 * characters that happen to spell a word ("readable", "deadfeed") are far more likely to be a
 * real path segment than an id. Dashes are stripped first so "8f2c-41ab" reads as one id.
 */
function isHexIdentifier(segment: string): boolean {
  const compact = segment.replace(/-/g, '')
  return compact.length >= 8 && HEX_ONLY.test(compact) && /\d/.test(compact)
}

function isPrefixedIdentifier(segment: string): boolean {
  const match = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*_([A-Za-z0-9]{6,})$/.exec(segment)
  return match !== null && looksLikeIdentifier(match[1])
}

function placeholderFor(segment: string): string | null {
  if (EMAIL.test(segment)) return ':email'
  if (UUID.test(segment)) return ':id'
  // A segment that is nothing but digits is an identifier in practice. Version markers show up
  // as "v2" rather than "2", so this does not swallow them.
  if (DIGITS_ONLY.test(segment)) return ':id'
  if (isHexIdentifier(segment)) return ':id'
  // Path segments carry the same prefixed ids as titles do; without this the grouping key keeps
  // the raw account id and one endpoint fragments into a problem per customer.
  if (isPrefixedIdentifier(segment)) return ':id'
  return null
}

/**
 * A "?" only starts a query string once a path is under way. Sentry names anonymous JS frames
 * "?(main)" and "?(a/b/c)", where a leading "?" is part of the name, not a separator.
 */
function stripQueryString(value: string): string {
  const separator = value.search(/[?#]/)
  const firstSlash = value.indexOf('/')
  if (separator === -1) return value
  if (firstSlash === -1 || separator < firstSlash) return value
  return value.slice(0, separator)
}

function normalizeSegment(segment: string): string {
  const whole = placeholderFor(segment)
  if (whole) return whole

  // Identifiers are not always a whole segment — "?(8e068bb67c90" and "bundle.4f1a09cd.js" both
  // carry one inside punctuation — so replace the runs that look like ids in place.
  return segment.replace(/[0-9a-f]{8,}/gi, (token) => (isHexIdentifier(token) ? ':id' : token))
}

/**
 * Sentry culprits for a multi-step journey read "route:step" — "/j/transaction-to-emi" and
 * "/j/transaction-to-emi:landing" are the same route at different steps, and presenting them as
 * two unrelated problems tells two stories where there is one. A bare ":id" placeholder has
 * nothing before the colon and is left alone.
 */
function stripRouteStep(segment: string): string {
  const match = /^(.+?):([A-Za-z][A-Za-z0-9_-]*)$/.exec(segment)
  return match ? match[1] : segment
}

function normalizePath(value: string): string {
  if (!value.includes('/')) return normalizeSegment(stripRouteStep(value))

  const segments = stripQueryString(value).split('/')
  const normalized = segments
    .map((segment, index) => {
      if (segment === '') return segment
      // Only the final segment carries a step suffix.
      const base = index === segments.length - 1 ? stripRouteStep(segment) : segment
      return normalizeSegment(base)
    })
    .join('/')

  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
}

/**
 * Collapses the dynamic parts of a Sentry culprit so that the same endpoint hit with different
 * ids reads as one problem. Returns null when there is no culprit to work with, leaving the
 * caller to fall back to another grouping key.
 */
export function normalizeCulprit(culprit: string | null | undefined): string | null {
  const trimmed = culprit?.trim()
  if (!trimmed) return null

  // Transaction names often arrive as "GET /api/accounts/8f2c/emi".
  const [head, ...rest] = trimmed.split(/\s+/)
  const normalized =
    rest.length > 0 && HTTP_METHOD.test(head)
      ? `${head.toUpperCase()} ${normalizePath(rest.join(' '))}`
      : normalizePath(trimmed)

  // An empty key would silently merge unrelated issues under a blank label.
  return normalized.trim() === '' ? null : normalized
}

// Order matters: timestamps are matched before hex runs, or a date's digits get eaten first.
const TIMESTAMP_TOKEN =
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s?(?:am|pm)?(?:Z|[+-]\d{2}:?\d{2})?)?/gi
const EMAIL_TOKEN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g
const UUID_TOKEN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
/**
 * Prefixed identifiers such as usrj_a3208812a773aeec or acc_ca_HYPmFOnLGHIID570ovj. The prefix may
 * itself contain underscores, so the token is anchored on a non-identifier character rather than
 * \b — after an underscore \b never matches, which let two-part prefixes through untouched.
 */
const PREFIXED_ID_TOKEN =
  /(?<![A-Za-z0-9_])[a-z][a-z0-9]*(?:_[a-z0-9]+)*_([A-Za-z0-9]{6,})(?![A-Za-z0-9_])/g

/**
 * Distinguishes an identifier from ordinary snake_case. Real ids carry digits or mixed case;
 * "user_preferences" and "checkout_session" are words and must survive, or unrelated endpoints
 * merge into one problem.
 */
function looksLikeIdentifier(token: string): boolean {
  return /\d/.test(token) || (/[a-z]/.test(token) && /[A-Z]/.test(token))
}
const LONG_HEX_TOKEN = /\b(?=[0-9a-f]*\d)[0-9a-f]{12,}\b/gi

/**
 * Sentry titles for this kind of app embed a journey id and a timestamp, which makes every title
 * unique — nothing can ever group, and the identifiers end up on screen and in screenshots where
 * they have no diagnostic value.
 */
export function scrubTitle(title: string): string {
  return title
    .replace(TIMESTAMP_TOKEN, ':timestamp')
    .replace(EMAIL_TOKEN, ':email')
    .replace(UUID_TOKEN, ':id')
    .replace(PREFIXED_ID_TOKEN, (whole, tail) => (looksLikeIdentifier(tail) ? ':id' : whole))
    .replace(LONG_HEX_TOKEN, ':id')
    // Keep a placeholder from fusing with the word after it when the source had no space.
    .replace(/:(timestamp|id|email)(?=[A-Za-z])/g, ':$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}
