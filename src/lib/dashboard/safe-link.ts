/**
 * Sentry issue titles, culprits and permalinks contain arbitrary text from production errors,
 * some of it derived from user input. A permalink is only rendered as a link when it is https
 * and points at the Sentry host we are configured to talk to.
 */
export function safeSentryLink(permalink: string, apiBaseUrl: string): string | null {
  let target: URL
  let expected: URL
  try {
    target = new URL(permalink)
    expected = new URL(apiBaseUrl)
  } catch {
    return null
  }

  if (target.protocol !== 'https:') return null

  // Sentry serves permalinks from the org subdomain as well as the bare host.
  const root = expected.hostname.split('.').slice(-2).join('.')
  const onExpectedHost =
    target.hostname === expected.hostname ||
    target.hostname === root ||
    target.hostname.endsWith(`.${root}`)

  return onExpectedHost ? target.toString() : null
}

/** Keeps a pathological title from breaking the layout. */
export function clampText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`
}
