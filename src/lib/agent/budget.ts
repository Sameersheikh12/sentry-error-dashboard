import { agentConfig } from '@/lib/config/agent.config'

/**
 * A spend ledger for agent runs.
 *
 * Every run reports what it cost, and this refuses to start another once the total reaches the
 * configured share of the budget. The point is not to be an accounting system — it is that an
 * agent that spends money on page load needs some number it will not go past, and "report the
 * limit" is a better failure than "keep going".
 *
 * Process-lifetime, like the analysis cache: restarting the server resets it. That is the honest
 * scope for something with no database, and it is stated on screen rather than implied.
 */
let spentUsd = 0

export interface BudgetStatus {
  spentUsd: number
  budgetUsd: number
  /** The amount at which further runs are refused. */
  stopAtUsd: number
  fractionUsed: number
  exhausted: boolean
}

export function budgetStatus(): BudgetStatus {
  const budgetUsd = agentConfig.budgetUsd
  const stopAtUsd = budgetUsd * agentConfig.budgetStopFraction
  return {
    spentUsd,
    budgetUsd,
    stopAtUsd,
    // A budget of zero is "spend nothing", not "divide by zero".
    fractionUsed: budgetUsd > 0 ? spentUsd / budgetUsd : 1,
    exhausted: spentUsd >= stopAtUsd,
  }
}

export function recordSpend(costUsd: number): void {
  if (Number.isFinite(costUsd) && costUsd > 0) spentUsd += costUsd
}

/** Only for tests and for an explicit reset from the UI. */
export function resetSpend(): void {
  spentUsd = 0
}

export function budgetMessage(status: BudgetStatus): string {
  const percent = Math.round(agentConfig.budgetStopFraction * 100)
  return (
    `Spend limit reached: $${status.spentUsd.toFixed(2)} spent, and this dashboard stops at ` +
    `$${status.stopAtUsd.toFixed(2)} — ${percent}% of its $${status.budgetUsd.toFixed(2)} budget. ` +
    `No further analysis will run until the budget is raised (CLAUDE_AGENT_BUDGET_USD) or the ` +
    `server is restarted. Everything else on this page is unaffected.`
  )
}
