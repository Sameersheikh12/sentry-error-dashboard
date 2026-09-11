import type { Timeline, TimelineBucket } from '@/lib/analysis/timeline'
import { FAINT_TEXT, MUTED_TEXT } from './controls'
import { formatCount } from './format'
import { STATE_STYLES } from './state-styles'

const WIDTH = 1000
const HEIGHT = 110
const OTHER_FILL = 'fill-slate-400 dark:fill-slate-600'

const seriesFill = (state: Timeline['series'][number]['state']) =>
  state === 'OTHER' ? OTHER_FILL : STATE_STYLES[state].fill

// Adjacent series can share a state colour; stepping the opacity keeps their boundary visible
// without inventing a second palette.
const seriesOpacity = (index: number) => 1 - Math.min(index, 4) * 0.13

function utc(timestamp: number): string {
  return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 16)
}

function bucketLabel(bucket: TimelineBucket, timeline: Timeline): string {
  const parts = timeline.series
    .map((series, index) => ({ series, value: bucket.values[index] }))
    .filter((entry) => entry.value > 0)
    .map((entry) => `${entry.series.label}: ${formatCount(entry.value)}`)

  return [
    `${utc(bucket.timestamp)} UTC`,
    bucket.partial ? 'PARTIAL — this interval is still filling' : null,
    `${formatCount(bucket.total)} events`,
    ...parts,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Stacked by problem rather than by state: one problem can be most of the volume, and a
 * state-only stack would then be a picture of that problem and nothing else.
 */
export function TimelineChart({ timeline }: { timeline: Timeline }) {
  if (timeline.buckets.length === 0) {
    return (
      <section className={`rounded-lg border border-slate-500/25 px-4 py-6 text-sm ${MUTED_TEXT}`}>
        No event series for this window.
      </section>
    )
  }

  const peak = Math.max(...timeline.buckets.map((bucket) => bucket.total), 1)
  const slotWidth = WIDTH / timeline.buckets.length
  const barWidth = Math.max(1, slotWidth - 1)
  const hasPartial = timeline.buckets.some((bucket) => bucket.partial)

  return (
    <section className="rounded-lg border border-slate-500/25 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className={`text-[11px] font-semibold uppercase tracking-wide ${MUTED_TEXT}`}>
          Volume over window · top {timeline.series.filter((s) => s.state !== 'OTHER').length} problems
        </h2>
        <div className={`flex flex-wrap gap-3 text-[11px] ${MUTED_TEXT}`}>
          {timeline.series.map((series, index) => (
            <span key={series.key} className="inline-flex max-w-64 items-center gap-1">
              <svg width="8" height="8" aria-hidden className="shrink-0">
                <rect
                  width="8"
                  height="8"
                  className={seriesFill(series.state)}
                  opacity={seriesOpacity(index)}
                />
              </svg>
              <span className="truncate font-mono">{series.label}</span>
            </span>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-28 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Event volume across ${timeline.buckets.length} buckets, peaking at ${formatCount(peak)}`}
      >
        {timeline.buckets.map((bucket, bucketIndex) => {
          let offset = 0
          return (
            <g key={bucket.timestamp}>
              {bucket.values.map((value, seriesIndex) => {
                if (value === 0) return null
                const height = (value / peak) * HEIGHT
                offset += height
                return (
                  <rect
                    key={timeline.series[seriesIndex].key}
                    x={bucketIndex * slotWidth}
                    y={HEIGHT - offset}
                    width={barWidth}
                    height={height}
                    className={seriesFill(timeline.series[seriesIndex].state)}
                    opacity={(bucket.partial ? 0.45 : 1) * seriesOpacity(seriesIndex)}
                  />
                )
              })}
              {/* Full-height hit area so a short bar is still hoverable. */}
              <rect
                x={bucketIndex * slotWidth}
                y={0}
                width={slotWidth}
                height={HEIGHT}
                fill="transparent"
              >
                <title>{bucketLabel(bucket, timeline)}</title>
              </rect>
            </g>
          )
        })}
      </svg>

      <div className={`mt-1 flex justify-between text-[11px] tabular-nums ${FAINT_TEXT}`}>
        <span>{utc(timeline.buckets[0].timestamp)}</span>
        {hasPartial && (
          <span className="italic">final interval still filling — shown faded</span>
        )}
        <span>{utc(timeline.buckets[timeline.buckets.length - 1].timestamp)} UTC</span>
      </div>
    </section>
  )
}
