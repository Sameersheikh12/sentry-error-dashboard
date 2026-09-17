export interface AgentConfig {
  /**
   * Exactly what the agent may do. A non-interactive session cannot ask for approval, and this
   * app has no business driving anything beyond reading Sentry and its own skill file.
   */
  allowedTools: readonly string[]
  /** An agent turn with several MCP round-trips is slow; this bounds a wedged run. */
  timeoutMs: number
  /**
   * How long one analysis stays cached. Keyed by the exact filter set, so changing a filter runs a
   * fresh analysis while refreshing the same view is free.
   */
  cacheSeconds: number
  /** Skip the agent when there is nothing above threshold to explain. */
  minIssuesToAnalyse: number
  /** How many ranked problems get an explanation. Each one is an MCP round-trip. */
  maxSubjects: number
  /**
   * Which model reads the events. This is the largest cost lever in the app. Measured over three
   * runs of the same view: $0.48 on the developer's default (opus, max effort) against
   * $0.053-$0.078 on haiku, with the same root causes found. The work is reading a field out of an
   * event and restating it, not reasoning. Overridable so a heavier model can be used deliberately.
   */
  model: string
  /**
   * How hard the model thinks. The second cost lever, and on this task the cheaper one to give up:
   * reading a field out of an event does not benefit from deliberation.
   */
  effort: string
  /**
   * What the picker in the UI may choose. An allowlist, not free text — these values are passed to
   * a spawned process, and "whatever the query string said" is not an acceptable source for that.
   */
  selectableModels: readonly string[]
  selectableEfforts: readonly string[]
  /**
   * What this dashboard may spend on agent runs before it stops asking. Not a billing limit —
   * nothing here can read your Claude account — but a cap this app holds itself to, so a left-open
   * tab or a filter being clicked through cannot quietly run up a bill.
   */
  budgetUsd: number
  /** Stop at this share of the budget, leaving the remainder as headroom rather than a hard wall. */
  budgetStopFraction: number
}

export const agentConfig: AgentConfig = {
  allowedTools: [
    'Read',
    'mcp__claude_ai_Sentry__search_events',
    'mcp__claude_ai_Sentry__search_issues',
    'mcp__claude_ai_Sentry__get_sentry_resource',
  ],
  timeoutMs: 180_000,
  cacheSeconds: 900,
  minIssuesToAnalyse: 1,
  maxSubjects: 3,
  model: process.env.CLAUDE_AGENT_MODEL ?? 'haiku',
  effort: process.env.CLAUDE_AGENT_EFFORT ?? 'low',
  selectableModels: ['haiku', 'sonnet', 'opus'],
  selectableEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  budgetUsd: Number(process.env.CLAUDE_AGENT_BUDGET_USD ?? 5),
  budgetStopFraction: 0.65,
}

/** The timeout in seconds, for copy that tells the reader when a run gives up. */
export const agentTimeoutSeconds = Math.round(agentConfig.timeoutMs / 1000)

/** Falls back to the configured default rather than trusting a value off the wire. */
export function resolveModel(requested: string | null | undefined): string {
  return requested && agentConfig.selectableModels.includes(requested)
    ? requested
    : agentConfig.model
}

export function resolveEffort(requested: string | null | undefined): string {
  return requested && agentConfig.selectableEfforts.includes(requested)
    ? requested
    : agentConfig.effort
}
