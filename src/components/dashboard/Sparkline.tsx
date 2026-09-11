import type { StatsPoint } from '@/lib/analysis/types'
import { FAINT_TEXT } from './controls'
import { formatClock, formatCount } from './format'

const WIDTH = 120
const HEIGHT = 24
const GAP = 1

/**
 * Hand-rolled bars from data already fetched. An absent series and a series of zeroes are
 * different facts and must not look the same.
 */
export function Sparkline({ buckets }: { buckets: StatsPoint[] }) {
  if (buckets.length === 0) {
    return <span className={`text-[11px] italic ${FAINT_TEXT}`}>no series</span>
  }

  const peak = Math.max(...buckets.map((bucket) => bucket.events))
  const barWidth = (WIDTH - GAP * (buckets.length - 1)) / buckets.length

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label={`${buckets.length} buckets, peaking at ${formatCount(peak)} events`}
      preserveAspectRatio="none"
    >
      {/* Baseline, so an all-zero window still reads as measured rather than missing. */}
      <rect x={0} y={HEIGHT - 0.5} width={WIDTH} height={0.5} className="fill-current opacity-25" />
      {buckets.map((bucket, index) => {
        const height =
          peak === 0 ? 0 : Math.max(bucket.events > 0 ? 1.5 : 0, (bucket.events / peak) * HEIGHT)
        return (
          <rect
            key={bucket.timestamp}
            x={index * (barWidth + GAP)}
            y={HEIGHT - height}
            width={barWidth}
            height={height}
            className="fill-current"
          >
            <title>{`${formatClock(bucket.timestamp)} UTC — ${formatCount(bucket.events)} events`}</title>
          </rect>
        )
      })}
    </svg>
  )
}
