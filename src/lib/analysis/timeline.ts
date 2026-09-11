import { emptyStateCounts, type IssueState, type Problem } from './types'

export interface TimelineSeries {
  key: string
  label: string
  /** 'OTHER' is the pooled remainder below the top N. */
  state: IssueState | 'OTHER'
}

export interface TimelineBucket {
  timestamp: number
  /** Parallel to `series`. */
  values: number[]
  total: number
  /** The trailing bucket is still filling; unmarked it reads as a sudden drop. */
  partial: boolean
}

export interface Timeline {
  series: TimelineSeries[]
  buckets: TimelineBucket[]
  intervalMs: number
}

const OTHER_KEY = '__other__'

function inferInterval(timestamps: number[]): number {
  if (timestamps.length < 2) return 0
  const gaps = timestamps.slice(1).map((value, index) => value - timestamps[index])
  return gaps.sort((left, right) => left - right)[Math.floor(gaps.length / 2)]
}

/**
 * Stacked by problem rather than by state, because one problem can be most of the volume and a
 * state-only stack then shows nothing but that problem. The top N keep their own colour from
 * their state; everything else pools into a quiet remainder.
 */
export function buildTimeline(
  problems: Problem[],
  options: { windowEnd: number; topProblems: number },
): Timeline {
  const ranked = [...problems].sort(
    (left, right) => right.aggregate.currentEvents - left.aggregate.currentEvents,
  )
  const top = ranked.slice(0, options.topProblems)
  const rest = ranked.slice(options.topProblems)

  const series: TimelineSeries[] = top.map((problem) => ({
    key: problem.key,
    label: problem.key,
    state: problem.state,
  }))
  if (rest.length > 0) {
    series.push({ key: OTHER_KEY, label: `${rest.length} other problems`, state: 'OTHER' })
  }

  const byTimestamp = new Map<number, number[]>()
  const addTo = (index: number, problem: Problem) => {
    for (const point of problem.buckets) {
      const row = byTimestamp.get(point.timestamp) ?? new Array(series.length).fill(0)
      row[index] += point.events
      byTimestamp.set(point.timestamp, row)
    }
  }

  top.forEach((problem, index) => addTo(index, problem))
  if (rest.length > 0) {
    const otherIndex = series.length - 1
    for (const problem of rest) addTo(otherIndex, problem)
  }

  const timestamps = [...byTimestamp.keys()].sort((left, right) => left - right)
  const intervalMs = inferInterval(timestamps)

  const buckets: TimelineBucket[] = timestamps.map((timestamp) => {
    const values = byTimestamp.get(timestamp) ?? new Array(series.length).fill(0)
    return {
      timestamp,
      values,
      total: values.reduce((sum, value) => sum + value, 0),
      partial: intervalMs > 0 && timestamp + intervalMs > options.windowEnd,
    }
  })

  return { series, buckets, intervalMs }
}
