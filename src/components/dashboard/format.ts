export { formatMultiplier } from '@/lib/analysis/score'

const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 3_600_000

export function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

// Rendered in UTC so a server-rendered timestamp cannot disagree with the browser's locale.
export function formatUtc(iso: string): string {
  return `${new Date(iso).toISOString().replace('T', ' ').slice(0, 19)} UTC`
}

export function formatClock(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(11, 16)
}

export function formatAgo(timestamp: number, now: number): string {
  const age = now - timestamp
  if (age < MS_PER_MINUTE) return 'just now'
  if (age < MS_PER_HOUR) return `${Math.round(age / MS_PER_MINUTE)}m ago`
  if (age < 24 * MS_PER_HOUR) return `${Math.round(age / MS_PER_HOUR)}h ago`
  return `${Math.round(age / (24 * MS_PER_HOUR))}d ago`
}

export function formatDelta(deltaPercent: number | null): string {
  if (deltaPercent === null) return 'no prior data'
  const rounded = Math.round(deltaPercent)
  return `${rounded >= 0 ? '+' : ''}${formatCount(rounded)}%`
}
