import { beforeEach, describe, expect, it } from 'vitest'
import { budgetMessage, budgetStatus, recordSpend, resetSpend } from '@/lib/agent/budget'
import { agentConfig } from '@/lib/config/agent.config'

/**
 * The agent spends real money on page load, so the thing that stops it is worth testing more than
 * the thing that starts it.
 */
describe('agent spend budget', () => {
  beforeEach(resetSpend)

  it('starts clean and permits work', () => {
    const status = budgetStatus()
    expect(status.spentUsd).toBe(0)
    expect(status.exhausted).toBe(false)
  })

  it('stops at the configured share of the budget, not at the whole budget', () => {
    expect(agentConfig.budgetStopFraction).toBe(0.65)
    // Just under the stop point.
    recordSpend(agentConfig.budgetUsd * 0.64)
    expect(budgetStatus().exhausted).toBe(false)
    // And over it.
    recordSpend(agentConfig.budgetUsd * 0.02)
    expect(budgetStatus().exhausted).toBe(true)
  })

  it('accumulates across runs rather than looking at one run in isolation', () => {
    for (let i = 0; i < 10; i += 1) recordSpend(agentConfig.budgetUsd * 0.07)
    expect(budgetStatus().spentUsd).toBeCloseTo(agentConfig.budgetUsd * 0.7, 5)
    expect(budgetStatus().exhausted).toBe(true)
  })

  it('ignores costs that are not usable numbers, rather than poisoning the total', () => {
    recordSpend(Number.NaN)
    recordSpend(-5)
    recordSpend(Number.POSITIVE_INFINITY)
    expect(budgetStatus().spentUsd).toBe(0)
  })

  it('reports the limit in a message that names both numbers', () => {
    recordSpend(agentConfig.budgetUsd)
    const status = budgetStatus()
    const message = budgetMessage(status)
    expect(message).toContain(agentConfig.budgetUsd.toFixed(2))
    // Both numbers, so "why did it stop here" is answerable from the message alone.
    expect(message).toContain(status.stopAtUsd.toFixed(2))
    expect(message).toContain('65%')
    // It must read as a deliberate stop, not a fault.
    expect(message).toContain('Everything else on this page is unaffected.')
  })
})
