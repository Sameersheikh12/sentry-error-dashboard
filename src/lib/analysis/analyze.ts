import { aggregate } from './aggregate'
import { classifyState, type ClassifyFacts, type ClassifyOptions } from './classify'
import { clusterIssues, mergeBuckets } from './group'
import { checkIssue, type InvariantViolation } from './invariants'
import { explainProblem, scoreProblem, type ScoreOptions } from './score'
import type { AnalyzedIssue, IssueSnapshot, Problem } from './types'
import type { AnalysisConfig } from '@/lib/config/analysis.config'

export interface AnalysisInput {
  snapshots: IssueSnapshot[]
  now: number
  windowStart: number
  windowEnd: number
  windowHours: number
  /** Where the baseline query began, already clamped to retention. */
  baselineQueryStart: number
  intendedBaselineStart: number
  config: AnalysisConfig
}

export interface AnalysisResult {
  problems: Problem[]
  /** Rows that failed an invariant and were withheld rather than rendered. */
  violations: InvariantViolation[]
}

/**
 * A regression is a property of one member: an issue Sentry marked regressed, or one that is
 * resolved yet still firing. Testing "any member resolved" against the group's event count would
 * relabel a busy cluster because one silent member happened to be closed.
 */
function problemFacts(issues: AnalyzedIssue[]): ClassifyFacts {
  const regressed = issues.some(
    (issue) =>
      issue.snapshot.substatus === 'regressed' ||
      (issue.snapshot.status === 'resolved' && issue.snapshot.currentEvents > 0),
  )

  return { substatus: regressed ? 'regressed' : null, status: 'unresolved' }
}

/**
 * The whole pure pipeline. The window and the clock arrive as parameters so the result is a
 * function of its inputs and nothing else.
 */
export function analyzeIssues(input: AnalysisInput): AnalysisResult {
  const { config, now, windowStart, windowEnd, windowHours } = input
  const violations: InvariantViolation[] = []

  const window = { start: windowStart, end: windowEnd }
  const usable = input.snapshots.filter((snapshot) => {
    const failures = checkIssue(snapshot, window)
    violations.push(...failures)
    return failures.length === 0
  })

  const aggregateOptions = {
    windowStart,
    windowHours,
    baselineQueryStart: input.baselineQueryStart,
    intendedBaselineStart: input.intendedBaselineStart,
    minBaselineHours: config.minBaselineHours,
    velocityEpsilon: config.velocityEpsilon,
  }
  const classifyOptions: ClassifyOptions = {
    windowStart,
    windowHours,
    surgeMultiplier: config.surgeMultiplier,
    minEventFloor: config.minEventFloor,
    fadeThreshold: config.fadeThreshold,
  }
  const scoreOptions: ScoreOptions = {
    now,
    windowHours,
    stateWeight: config.stateWeight,
    weights: config.weights,
    velocityCeiling: config.velocityCeiling,
  }

  const analyzed: AnalyzedIssue[] = usable.map((snapshot) => {
    // An issue is an aggregate of one, so an issue row and a problem row are produced by the
    // same code and cannot disagree about what they describe.
    const issueAggregate = aggregate([snapshot], aggregateOptions)
    const state = classifyState(snapshot, issueAggregate, classifyOptions)

    return {
      snapshot,
      aggregate: issueAggregate,
      state,
      score: scoreProblem(state, issueAggregate, scoreOptions),
      reason: explainProblem(state, issueAggregate, {
        now,
        memberCount: 1,
        stateMemberCount: 1,
        surgeThreshold: config.surgeMultiplier,
      }),
    }
  })

  const clusters = clusterIssues(analyzed, config.groupingDimension, {
    extractors: config.groupingExtractors,
    wrapperPrefixes: config.wrapperTypePrefixes,
    genericTypeNames: config.genericTypeNames,
  })

  const problems: Problem[] = []
  for (const cluster of clusters) {
    const issues = [...cluster.issues].sort((left, right) => right.score - left.score)
    const problemAggregate = aggregate(
      issues.map((issue) => issue.snapshot),
      aggregateOptions,
    )
    const state = classifyState(problemFacts(issues), problemAggregate, classifyOptions)

    const problem: Problem = {
      key: cluster.key,
      extractor: cluster.extractor,
      looseGrouping: cluster.looseGrouping,
      state,
      aggregate: problemAggregate,
      // A mature problem that grew a member is worth surfacing, but as a marker rather than a
      // promotion that would put the oldest, largest problems at the top of the list.
      hasNewVariant:
        state !== 'NEW' &&
        issues.some((issue) => issue.snapshot.firstSeen >= windowStart),
      // FADING is defined as zero events in the window, so testing it against an event or user
      // floor would reject every one of them. Its significance was already established by
      // classify(), which requires a baseline big enough for the silence to mean something.
      belowThreshold:
        state !== 'FADING' &&
        (problemAggregate.currentEvents < config.minEventFloor ||
          problemAggregate.userCount < config.minUserFloor),
      score: scoreProblem(state, problemAggregate, scoreOptions),
      reason: explainProblem(state, problemAggregate, {
        now,
        memberCount: issues.length,
        stateMemberCount: issues.filter((issue) => issue.state === state).length,
        surgeThreshold: config.surgeMultiplier,
      }),
      buckets: mergeBuckets(issues),
      issues,
    }

    problems.push(problem)
  }

  return {
    problems: problems.sort((left, right) => right.score - left.score),
    violations,
  }
}
