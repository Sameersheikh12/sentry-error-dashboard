import { z } from 'zod'
import { scrubTitle } from '@/lib/analysis/normalize'
import { AgentBudgetExhaustedError } from '@/lib/sentry/errors'
import { budgetMessage, budgetStatus, recordSpend } from './budget'
import { runClaude } from './claude-cli'

/**
 * A follow-up question about one already-analysed problem.
 *
 * Scoped deliberately: the prompt names the problem, its issues and what the first pass already
 * found, and says to stay on it. This is not a chatbot bolted to a dashboard — it is the second
 * half of a triage conversation that the panel above started, and the value is that the agent can
 * go back to Sentry and look, which is the one thing the computed layer cannot do.
 */
export const askTurnSchema = z.object({
  role: z.enum(['user', 'agent']),
  text: z.string().max(4000),
})

export const askRequestSchema = z.object({
  key: z.string().max(400),
  state: z.string().max(40),
  issueIds: z.array(z.string().max(80)).max(10),
  /** What the sweep already established, so the follow-up does not pay to rediscover it. */
  rootCause: z.string().max(2000).nullable(),
  plainEnglish: z.string().max(4000),
  question: z.string().min(1).max(1000),
  history: z.array(askTurnSchema).max(20),
  model: z.string(),
  effort: z.string(),
})

export type AskTurn = z.infer<typeof askTurnSchema>
export type AskRequest = z.infer<typeof askRequestSchema>

export interface AskContext {
  organization: string
  projectSlug: string
  window: string
  environment: string
}

export interface AskResult {
  answer: string
  costUsd: number
  durationMs: number
  turns: number
}

function buildPrompt(request: AskRequest, context: AskContext): string {
  // Only the last few turns: a follow-up thread is short by design, and an unbounded history is
  // an unbounded prompt, paid for on every question.
  const history = request.history
    .slice(-6)
    .map((turn) => `${turn.role === 'user' ? 'Q' : 'A'}: ${turn.text}`)
    .join('\n')

  return [
    `Sentry org ${context.organization}, project ${context.projectSlug},`,
    `environment ${context.environment}, window ${context.window}.`,
    ``,
    `A question about ONE problem that has already been analysed:`,
    `  problem: ${request.key}`,
    `  state: ${request.state}`,
    `  Sentry issues: ${request.issueIds.slice(0, 5).join(', ') || '(none recorded)'}`,
    `  upstream error already found: ${request.rootCause ?? '(none in the event)'}`,
    `  summary already given: ${request.plainEnglish}`,
    ``,
    history ? `Earlier in this conversation:\n${history}\n` : ``,
    `Question: ${request.question}`,
    ``,
    `Answer it using the Sentry MCP where you need to look something up — you may read events,`,
    `search by any field, and check other issues in this project. Follow`,
    `.claude/skills/triage/investigate.md: the cause usually lives in the event's Extra Data, not`,
    `the title.`,
    ``,
    `Rules:`,
    `- Stay on this problem. If the question is about something else, say so and name what you`,
    `  would need to be asked instead.`,
    `- Do not repeat what is already given above unless the question is about it.`,
    `- Never invent a number, a cause or an event. Say what you could not determine.`,
    `- Never include user identifiers, journey ids or email addresses in the reply.`,
    `- Answer in plain prose, at most 150 words. No JSON, no markdown headings.`,
  ]
    .filter((line) => line !== ``)
    .join('\n')
}

export async function askAboutProblem(
  request: AskRequest,
  context: AskContext,
): Promise<AskResult> {
  const budget = budgetStatus()
  if (budget.exhausted) throw new AgentBudgetExhaustedError(budgetMessage(budget))

  const run = await runClaude(buildPrompt(request, context), {
    model: request.model,
    effort: request.effort,
  })
  recordSpend(run.costUsd)

  return {
    // Scrubbed on the way out for the same reason the sweep is: the instruction not to include
    // identifiers is a request, and a real run has ignored it before.
    answer: scrubTitle(run.text).slice(0, 4000),
    costUsd: run.costUsd,
    durationMs: run.durationMs,
    turns: run.turns,
  }
}
