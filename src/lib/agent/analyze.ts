import { z } from 'zod'
import { scrubTitle } from '@/lib/analysis/normalize'
import type { IssueState } from '@/lib/analysis/types'
import { agentConfig } from '@/lib/config/agent.config'
import { AgentBudgetExhaustedError, SentryUpstreamError } from '@/lib/sentry/errors'
import { budgetMessage, budgetStatus, recordSpend } from './budget'
import { runClaude } from './claude-cli'

/**
 * The agent answers by subject number, not by key.
 *
 * Asked to echo a key back, it returned the Sentry short id instead — the answer was right and the
 * label was wrong, which is the worst possible failure for a join. An index is checked against the
 * subjects that were sent, so the key displayed is the one this app assigned and cannot drift.
 */
const agentReplyProblemSchema = z.object({
  index: z.number().int().positive(),
  /** The upstream error, when the event carries one. This is the part only the agent can supply. */
  rootCause: z.string().nullable(),
  plainEnglish: z.string(),
})

const agentReplySchema = z.object({
  verdict: z.string(),
  problems: z.array(agentReplyProblemSchema),
  notes: z.array(z.string()),
})

export type AgentReply = z.infer<typeof agentReplySchema>

export interface AgentProblem {
  /** Assigned here from the subject list, so it always matches the table's Problem column. */
  key: string
  /** Carried over from the ranking so the panel and the table label the same problem alike. */
  state: IssueState
  /** The Sentry issues behind this problem, so a follow-up can be scoped to exactly them. */
  issueIds: string[]
  rootCause: string | null
  plainEnglish: string
}

export interface AgentAnalysis {
  verdict: string
  problems: AgentProblem[]
  notes: string[]
}

export interface AgentResult {
  analysis: AgentAnalysis
  /** What produced this. Shown on screen, because these set both the cost and the quality. */
  model: string
  effort: string
  costUsd: number
  durationMs: number
  turns: number
  analysedAt: string
  cached: boolean
  /** How many problems this response had to analyse, and how many came from cache. */
  analysedNow: number
  fromCache: number
}

export interface AgentSubject {
  key: string
  state: IssueState
  issueIds: string[]
}

export interface AgentRequest {
  organization: string
  projectSlug: string
  window: string
  environment?: string
  /** The ranked problems, already computed. The agent explains them; it does not recount them. */
  subjects: AgentSubject[]
  /** Already validated against the allowlist in agent.config.ts before it reaches here. */
  model: string
  effort: string
  /**
   * `sweep` is the run that happens on load: it reads the top-ranked problems and forms the
   * verdict over them. `add` is a later run for problems the sweep left out — it contributes
   * findings but does not restate the verdict, because it has not looked at the whole picture.
   */
  mode: 'sweep' | 'add'
}

/**
 * The agent is given the ranked problems rather than asked to derive them. Counting events and
 * dividing by hours is arithmetic the pure layer already does in milliseconds and can prove with
 * tests; asking the agent to derive the same ranking instead of explaining it measured many times
 * slower and more expensive for no different an answer. What only the agent can do is open an
 * event and say what the error actually means, so that is all it is asked for. Current cost and
 * timing numbers are in README.md rather than duplicated here, where they would go stale unnoticed.
 */
function buildPrompt(request: AgentRequest): string {
  const environment = request.environment ?? 'prod'
  const subjects = request.subjects
    .map((s, i) => `${i + 1}. ${s.key} [${s.state}] issues: ${s.issueIds.slice(0, 3).join(', ')}`)
    .join('\n')

  const wantsVerdict = request.mode === 'sweep'

  return [
    `Sentry org ${request.organization}, project ${request.projectSlug}, environment ${environment},`,
    `window ${request.window}. These problems are already ranked:`,
    ``,
    subjects,
    ``,
    `For each, read ONE representative issue with the Sentry MCP and report the real upstream cause.`,
    `Follow .claude/skills/triage/investigate.md: the cause is usually in the event's Extra Data`,
    `(extra.logs / extra.detail), NOT the title. Quote the upstream error verbatim when present.`,
    ``,
    `Reply with ONLY JSON, no prose and no code fence:`,
    `{`,
    wantsVerdict
      ? `  "verdict": "one sentence naming the most important thing happening",`
      : `  "verdict": "",`,
    `  "problems": [{ "index": <the number of the problem above, e.g. 1>,`,
    `                 "rootCause": "verbatim upstream error or null",`,
    `                 "plainEnglish": "what it means and what it implies, 1-2 sentences" }],`,
    `  "notes": ["caveats, and anything you could not determine"]`,
    `}`,
    ``,
    `Use the numbers above as "index". Do not put a Sentry issue id or a path in that field.`,
    // The reader never sees the numbering, so a verdict that cites it is unreadable on screen.
    `Do not refer to the problems by number in "verdict" or "plainEnglish" — name the endpoint.`,
    `Never invent a cause. If the event carries no upstream error, set rootCause to null and say so.`,
    `Never include user identifiers, journey ids or emails anywhere in the reply.`,
    // Asking is not enough: a run that was told this still returned "No Journey found with User
    // Journey ID usrj_...". The reply is scrubbed on the way out, the same way titles are.
  ].join('\n')
}

/**
 * Findings are cached per problem, not per set of problems.
 *
 * The obvious design — one entry keyed by the whole subject list — makes "read one more problem"
 * pathological: adding a fourth key changes the key, misses, and pays to re-read the three that
 * were already done. Keyed per problem, a later run simply finds three hits and one miss and only
 * pays for the miss. It also means a problem that drops out of the ranking stops being shown
 * without invalidating anything else.
 */
interface FindingEntry {
  problem: AgentProblem
  expiresAt: number
}

/** The verdict belongs to the sweep: it is a statement about the set, not about one problem. */
interface VerdictEntry {
  verdict: string
  notes: string[]
  expiresAt: number
}

const findingCache = new Map<string, FindingEntry>()
const verdictCache = new Map<string, VerdictEntry>()

/** Everything that changes what an answer would be, except which problems were asked about. */
const viewKey = (request: AgentRequest) =>
  [
    request.organization,
    request.projectSlug,
    request.window,
    request.environment ?? 'prod',
    // So switching model or effort reads afresh — and switching back is free, because the earlier
    // answers are still cached under their own keys.
    request.model,
    request.effort,
  ].join('|')

const findingKey = (request: AgentRequest, problemKey: string) =>
  `${viewKey(request)}|${problemKey}`

function liveFindings(
  request: AgentRequest,
  now: number,
): { cached: AgentProblem[]; missing: AgentSubject[] } {
  const cached: AgentProblem[] = []
  const missing: AgentSubject[] = []

  for (const subject of request.subjects) {
    const entry = findingCache.get(findingKey(request, subject.key))
    if (entry && entry.expiresAt > now) cached.push(entry.problem)
    else missing.push(subject)
  }

  return { cached, missing }
}

/**
 * The analysis for exactly the problems asked about, but only if every one is already cached.
 * Used by the panel to render what it has without ever starting a paid run.
 */
export function cachedAnalysis(request: AgentRequest, now = Date.now()): AgentResult | null {
  const { cached, missing } = liveFindings(request, now)
  if (missing.length > 0 || cached.length === 0) return null

  const verdict = verdictCache.get(viewKey(request))
  if (!verdict || verdict.expiresAt <= now) return null

  return {
    analysis: { verdict: verdict.verdict, problems: cached, notes: verdict.notes },
    model: request.model,
    effort: request.effort,
    costUsd: 0,
    durationMs: 0,
    turns: 0,
    analysedAt: new Date(now).toISOString(),
    cached: true,
    analysedNow: 0,
    fromCache: cached.length,
  }
}

/**
 * Turns a validated agent reply into what the page renders.
 *
 * Two things are enforced here rather than asked for in the prompt, because a prompt is a request
 * and this is a guarantee:
 *
 * - **The key is assigned from the subject list**, never echoed by the agent. Asked to repeat a key
 *   back, a run returned the Sentry short id instead: right answer, wrong label. An index outside
 *   the list is dropped rather than attached to the wrong problem.
 * - **Every free-text field is scrubbed.** A run that had been told not to include identifiers
 *   still replied "No Journey found with User Journey ID usrj_...". These are customer identifiers
 *   with no diagnostic value, and the same scrubber already keeps them out of titles.
 */
export function buildAnalysis(reply: AgentReply, subjects: AgentSubject[]): AgentAnalysis {
  return {
    verdict: scrubTitle(reply.verdict),
    problems: reply.problems.flatMap((problem) => {
      const subject = subjects[problem.index - 1]
      if (!subject) return []
      return [
        {
          key: subject.key,
          state: subject.state,
          issueIds: subject.issueIds,
          rootCause: problem.rootCause === null ? null : scrubTitle(problem.rootCause),
          plainEnglish: scrubTitle(problem.plainEnglish),
        },
      ]
    }),
    notes: reply.notes.map(scrubTitle),
  }
}

/**
 * One in-flight run per view, so two overlapping calls never both pay to read the same problem.
 *
 * The cache above only checks state at the moment a call is made — nothing stopped a second call
 * for the same view from starting while the first was still talking to the agent, each finding
 * the same problem "missing" and each paying to read it. A double-click on Re-analyse, or two
 * tabs open on the same URL, both do exactly this. A caller that finds a run already in flight for
 * its view waits for it, then re-checks the cache the normal way — which the first call has by
 * then very likely filled in, turning the second call into a free cache hit instead of a duplicate
 * spend.
 */
const inFlight = new Map<string, Promise<void>>()

export async function analyseWithAgent(
  request: AgentRequest,
  now = Date.now(),
): Promise<AgentResult> {
  const key = viewKey(request)

  const running = inFlight.get(key)
  if (running) await running.catch(() => {}) // its own failure is that call's to report, not ours

  const { cached, missing } = liveFindings(request, now)
  const heldVerdict = verdictCache.get(key)
  const verdictLive = heldVerdict && heldVerdict.expiresAt > now ? heldVerdict : null

  // Nothing left to read: assemble and spend nothing. This is also what makes re-adding a problem
  // that was already read free rather than merely cheap.
  //
  // The verdict TTL is designed to never lapse while every requested subject is still cached (see
  // the write below), so `verdictLive` should always be present here — but a stale verdict is a
  // reason to fall back to an empty one, never a reason to send the agent a prompt with nothing to
  // read, which is what asking it to restate a verdict over zero missing subjects would be.
  if (missing.length === 0) {
    return {
      analysis: {
        verdict: verdictLive?.verdict ?? '',
        problems: cached,
        notes: verdictLive?.notes ?? [],
      },
      model: request.model,
      effort: request.effort,
      costUsd: 0,
      durationMs: 0,
      turns: 0,
      analysedAt: new Date(now).toISOString(),
      cached: true,
      analysedNow: 0,
      fromCache: cached.length,
    }
  }

  // Checked after the cache, so a view that has already been analysed still renders once the
  // budget is spent — only new spending stops.
  const budget = budgetStatus()
  if (budget.exhausted) throw new AgentBudgetExhaustedError(budgetMessage(budget))

  // Registered before the first `await` below, so a second call for this same view — arriving
  // while this one is still talking to the agent — waits on it rather than starting its own run.
  let releaseBarrier = () => {}
  inFlight.set(
    key,
    new Promise<void>((resolve) => {
      releaseBarrier = resolve
    }),
  )

  try {
    // The agent is asked about the problems that are missing, never about the whole list. An `add`
    // run for one problem therefore sends one problem, and costs accordingly.
    const toRead: AgentRequest = { ...request, subjects: missing }
    const run = await runClaude(buildPrompt(toRead), {
      model: request.model,
      effort: request.effort,
    })

    // The agent returns text; a fenced or chatty reply is recoverable, a malformed one is not.
    const body = run.text.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim()
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')

    let parsed: unknown
    try {
      parsed = JSON.parse(start >= 0 && end > start ? body.slice(start, end + 1) : body)
    } catch (cause) {
      throw new SentryUpstreamError(
        'The agent produced an analysis this app could not read.',
        `Reply began: ${body.slice(0, 400)}`,
        { cause },
      )
    }

    const validated = agentReplySchema.safeParse(parsed)
    if (!validated.success) {
      throw new SentryUpstreamError(
        'The agent produced an analysis in an unexpected shape.',
        validated.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      )
    }

    recordSpend(run.costUsd)

    const fresh = buildAnalysis(validated.data, missing)
    const expiresAt = now + agentConfig.cacheSeconds * 1000
    for (const problem of fresh.problems) {
      findingCache.set(findingKey(request, problem.key), { problem, expiresAt })
    }

    // Only a sweep has looked at the whole set, so only a sweep may state the verdict — an
    // add-run keeps the sweep's text. The expiry is renewed either way: this write is real work
    // that just happened, and freezing it to the original sweep's expiry let the verdict go stale
    // while an add-run's own findings (renewed above at the same `expiresAt`) were still live,
    // which could leave a later call with nothing missing but no live verdict either.
    const verdict =
      request.mode === 'sweep' || !verdictLive
        ? { verdict: fresh.verdict, notes: fresh.notes, expiresAt }
        : { ...verdictLive, expiresAt }
    verdictCache.set(key, verdict)

    // Returned in the order asked for, so the panel keeps rank order rather than cache order.
    const byKey = new Map([...cached, ...fresh.problems].map((problem) => [problem.key, problem]))
    const problems = request.subjects.flatMap((subject) => {
      const problem = byKey.get(subject.key)
      return problem ? [problem] : []
    })

    return {
      analysis: { verdict: verdict.verdict, problems, notes: verdict.notes },
      model: request.model,
      effort: request.effort,
      costUsd: run.costUsd,
      durationMs: run.durationMs,
      turns: run.turns,
      analysedAt: new Date(now).toISOString(),
      cached: false,
      analysedNow: fresh.problems.length,
      fromCache: cached.length,
    }
  } finally {
    inFlight.delete(key)
    releaseBarrier()
  }
}

/** Only for tests: the caches are process-lifetime, like the rest of the agent layer. */
export function resetAnalysisCache(): void {
  findingCache.clear()
  verdictCache.clear()
  inFlight.clear()
}
