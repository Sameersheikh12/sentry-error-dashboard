import {
  emptyStateCounts,
  type AnalyzedIssue,
  type GroupingExtractor,
  type IssueState,
  type IssueSnapshot,
  type Problem,
} from './types'

export interface AnalysisDiagnostics {
  issuesScanned: number
  /** Present in the current window versus seen only in the baseline period. */
  issuesWithCurrentEvents: number
  issuesBaselineOnly: number
  issueStateCounts: Record<IssueState, number>
  problemStateCounts: Record<IssueState, number>
  extractorCounts: Record<GroupingExtractor, number>
  looseClusters: number
  /** Rows withheld because they failed an invariant. */
  invariantViolations: number
  /** Why an issue could not reach a given state, so a silent state is distinguishable from a broken one. */
  notes: string[]
}

function emptyExtractorCounts(): Record<GroupingExtractor, number> {
  return { 'api-path': 0, 'exception-type': 0, 'normalized-culprit': 0, 'issue-id': 0 }
}

export function diagnose(
  snapshots: IssueSnapshot[],
  issues: AnalyzedIssue[],
  problems: Problem[],
  invariantViolations: number,
): AnalysisDiagnostics {
  const issueStateCounts = emptyStateCounts()
  for (const issue of issues) issueStateCounts[issue.state] += 1

  const problemStateCounts = emptyStateCounts()
  const extractorCounts = emptyExtractorCounts()
  for (const problem of problems) {
    problemStateCounts[problem.state] += 1
    extractorCounts[problem.extractor] += 1
  }

  const regressedReported = snapshots.filter((issue) => issue.substatus === 'regressed').length
  const notes: string[] = []
  if (issueStateCounts.REGRESSED === 0) {
    notes.push(
      `Sentry reported substatus "regressed" on ${regressedReported} of ${snapshots.length} issues in this window, so REGRESSED has nothing to fire on.`,
    )
  }
  if (issueStateCounts.NEW === 0) {
    notes.push('No issue has a firstSeen inside the window; widen the window to see NEW fire.')
  }
  if (invariantViolations > 0) {
    notes.push(
      `${invariantViolations} row(s) failed an invariant and were withheld rather than rendered.`,
    )
  }
  if (issueStateCounts.FADING === 0) {
    notes.push(
      'No issue has a baseline large enough for silence to be meaningful, so FADING is idle rather than broken.',
    )
  }

  return {
    issuesScanned: snapshots.length,
    issuesWithCurrentEvents: snapshots.filter((issue) => issue.currentEvents > 0).length,
    issuesBaselineOnly: snapshots.filter((issue) => issue.currentEvents === 0).length,
    issueStateCounts,
    problemStateCounts,
    extractorCounts,
    looseClusters: problems.filter((problem) => problem.looseGrouping).length,
    invariantViolations,
    notes,
  }
}
