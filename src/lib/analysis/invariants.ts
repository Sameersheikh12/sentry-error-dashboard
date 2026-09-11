import type { IssueSnapshot } from './types'

export interface InvariantViolation {
  subject: string
  rule: string
  detail: string
}

export interface InvariantWindow {
  start: number
  end: number
}

/**
 * Cheap assertions that catch a whole class of silent wrongness — figures read from the wrong
 * period, rows that predate the window, multipliers invented from nothing. A row that fails one
 * of these is not rendered, because a wrong number here is indistinguishable from a right one.
 */
export function checkIssue(
  snapshot: IssueSnapshot,
  window: InvariantWindow,
): InvariantViolation[] {
  const violations: InvariantViolation[] = []
  const subject = snapshot.shortId

  if (snapshot.userCount > snapshot.currentEvents) {
    violations.push({
      subject,
      rule: 'users<=events',
      detail: `${snapshot.userCount} users against ${snapshot.currentEvents} events in the window — the two figures came from different periods`,
    })
  }

  // An issue silent in the window is legitimately last seen in the baseline; one that fired in
  // the window must have fired inside it.
  if (snapshot.currentEvents > 0 && snapshot.lastSeen < window.start) {
    violations.push({
      subject,
      rule: 'lastSeen-in-window',
      detail: `last seen ${new Date(snapshot.lastSeen).toISOString()} but reported ${snapshot.currentEvents} events inside the window`,
    })
  }

  return violations
}
