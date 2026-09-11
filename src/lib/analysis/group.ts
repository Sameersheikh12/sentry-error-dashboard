import { groupingSignature, type ExtractorOptions } from './extract'
import type { AnalyzedIssue, GroupingDimension, GroupingExtractor, StatsPoint } from './types'

export interface IssueCluster {
  key: string
  extractor: GroupingExtractor
  looseGrouping: boolean
  issues: AnalyzedIssue[]
}

const SIGNIFICANT_TOKEN = /[a-z][a-z0-9]{3,}/g

function tokenize(value: string): string[] {
  return value.toLowerCase().match(SIGNIFICANT_TOKEN) ?? []
}

/**
 * A merge is loose when its members share nothing but the key and the boilerplate around it.
 * The wrapper prefixes have to be discounted too, or every issue titled "PWA Journey API Error"
 * looks related to every other one purely because of the words the wrapper added.
 */
function isLooseGrouping(
  issues: AnalyzedIssue[],
  key: string,
  wrapperPrefixes: readonly string[],
): boolean {
  if (issues.length < 2) return false

  const ignored = new Set(tokenize([key, ...wrapperPrefixes].join(' ')))
  let shared: string[] | undefined

  for (const issue of issues) {
    const tokens = tokenize(issue.snapshot.title).filter((token) => !ignored.has(token))
    shared = shared === undefined ? tokens : shared.filter((token) => tokens.includes(token))
    if (shared.length === 0) return true
  }

  return (shared?.length ?? 0) === 0
}

export function mergeBuckets(issues: AnalyzedIssue[]): StatsPoint[] {
  const totals = new Map<number, number>()
  for (const issue of issues) {
    for (const bucket of issue.snapshot.buckets) {
      totals.set(bucket.timestamp, (totals.get(bucket.timestamp) ?? 0) + bucket.events)
    }
  }

  return [...totals]
    .sort(([left], [right]) => left - right)
    .map(([timestamp, events]) => ({ timestamp, events }))
}

export function clusterIssues(
  issues: AnalyzedIssue[],
  dimension: GroupingDimension,
  options: ExtractorOptions,
): IssueCluster[] {
  // 'none' is the escape hatch for judging the grouping itself: one problem per Sentry issue.
  const extractorOptions: ExtractorOptions =
    dimension === 'none' ? { ...options, extractors: ['issue-id'] } : options

  const clusters = new Map<string, IssueCluster>()

  for (const issue of issues) {
    const { key, extractor } = groupingSignature(issue.snapshot, extractorOptions)
    const existing = clusters.get(key)
    if (existing) existing.issues.push(issue)
    else clusters.set(key, { key, extractor, looseGrouping: false, issues: [issue] })
  }

  return [...clusters.values()].map((cluster) => ({
    ...cluster,
    looseGrouping: isLooseGrouping(cluster.issues, cluster.key, options.wrapperPrefixes),
  }))
}
