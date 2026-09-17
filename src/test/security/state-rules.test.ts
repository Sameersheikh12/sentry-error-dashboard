import { describe, expect, it } from 'vitest'
import {
  baselineExplanation,
  stateRules,
  stateTooltip,
  thresholdExplanation,
} from '@/components/dashboard/state-rules'
import { analysisConfig } from '@/lib/config/analysis.config'

describe('on-screen explanation follows the config', () => {
  // The explanation exists so a reader can trust the labels. If it were written out by hand it
  // would quietly describe rules the code stopped applying.
  const tweaked = {
    ...analysisConfig,
    surgeMultiplier: 7,
    minEventFloor: 42,
    minUserFloor: 9,
    baselineMultiplier: 4,
    retentionDays: 30,
  }

  it('quotes the surge threshold and event floor actually in force', () => {
    const surging = stateRules(tweaked).find((rule) => rule.state === 'SURGING')
    expect(surging?.rule).toContain('7×')
    expect(surging?.rule).toContain('42 events')
  })

  it('quotes the baseline multiplier and retention actually in force', () => {
    const text = baselineExplanation(tweaked)
    expect(text).toContain('4×')
    expect(text).toContain('30-day')
  })

  it('quotes both signal floors actually in force', () => {
    const text = thresholdExplanation(tweaked)
    expect(text).toContain('42 events')
    expect(text).toContain('9 affected')
  })

  it('describes every state exactly once', () => {
    const states = stateRules().map((rule) => rule.state)
    expect(states).toEqual(['NEW', 'REGRESSED', 'SURGING', 'CHRONIC', 'FADING'].sort(
      (a, b) => states.indexOf(a as never) - states.indexOf(b as never),
    ))
    expect(new Set(states).size).toBe(5)
  })

  it('gives every state a one-line tooltip', () => {
    for (const { state } of stateRules()) {
      expect(stateTooltip(state).length).toBeGreaterThan(20)
      expect(stateTooltip(state)).not.toContain('\n')
    }
  })
})
