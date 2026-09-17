import type { IssueState } from '@/lib/analysis/types'
import { analysisConfig } from '@/lib/config/analysis.config'

export interface StateRule {
  state: IssueState
  /** The test that was applied, in words. */
  rule: string
  /** What passing that test tells you. */
  meaning: string
}

/**
 * Read from the live config rather than written out, so the explanation on screen is always the
 * rule the code actually applied. Change a threshold and this changes with it.
 */
export function stateRules(config = analysisConfig): StateRule[] {
  return [
    {
      state: 'NEW',
      rule: 'First seen inside the selected window',
      meaning: 'Never happened before now — the strongest signal on the page.',
    },
    {
      state: 'REGRESSED',
      rule: 'Marked regressed by Sentry, or resolved yet still producing events',
      meaning: 'Someone fixed this and it came back.',
    },
    {
      state: 'SURGING',
      rule: `Running at ${config.surgeMultiplier}× its own baseline or more, with at least ${config.minEventFloor} events in the window`,
      meaning: 'A known error behaving abnormally.',
    },
    {
      state: 'FADING',
      rule: `No events in the window, after a baseline that predicted at least ${config.minEventFloor}`,
      meaning: 'It has stopped — usually a fix landing.',
    },
    {
      state: 'CHRONIC',
      rule: 'Everything else that is still firing',
      meaning: 'Steady background noise. Most problems are this.',
    },
  ]
}

/** One line, for the tooltip on a badge. */
export function stateTooltip(state: IssueState, config = analysisConfig): string {
  const entry = stateRules(config).find((rule) => rule.state === state)
  return entry ? `${entry.rule} — ${entry.meaning}` : state
}

export function baselineExplanation(config = analysisConfig): string {
  return (
    `Each problem is compared against its own past: the ${config.baselineMultiplier}× stretch of time ` +
    `before the window, shortened to when the problem first appeared and capped at Sentry's ` +
    `${config.retentionDays}-day retention. Too little history to divide by means no multiplier at ` +
    `all, shown as a dash.`
  )
}

export function thresholdExplanation(config = analysisConfig): string {
  return (
    `A problem with fewer than ${config.minEventFloor} events or ${config.minUserFloor} affected ` +
    `users is kept but filed under "below threshold", so the headline count only promises things ` +
    `worth acting on. Fading problems are exempt — they are defined by having no events.`
  )
}
