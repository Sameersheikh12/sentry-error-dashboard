import { failureResponse } from '../failure-response'
import { readDashboardRequest } from '../dashboard-request'
import { analyseWithAgent, cachedAnalysis, type AgentRequest } from '@/lib/agent/analyze'
import { parseRequestedKeys, resolveSubjects } from '@/lib/agent/subjects'
import { agentConfig, resolveEffort, resolveModel } from '@/lib/config/agent.config'
import { serverEnvironment } from '@/lib/config/env'
import { loadDashboard } from '@/lib/dashboard/load-dashboard'

/**
 * The analysis produced by local Claude Code over the Sentry MCP.
 *
 * Separate from /api/problems so the table paints immediately and this arrives when it arrives —
 * an agent turn is tens of seconds, not milliseconds.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const { filters, project } = await readDashboardRequest(request)
    const data = await loadDashboard({ project, filters })

    // The top of the ranking is what the sweep reads. `add` names problems further down that the
    // reader has asked for by name — resolved against the ranking, never trusted from the URL.
    const rankedSubjects = data.problems.map((problem) => ({
      key: problem.key,
      state: problem.state,
      issueIds: problem.issues.map((issue) => issue.snapshot.shortId),
    }))

    const { subjects, mode } = resolveSubjects(
      rankedSubjects,
      parseRequestedKeys(url.searchParams.get('add')),
      agentConfig.maxSubjects,
    )

    const agentRequest: AgentRequest = {
      organization: serverEnvironment().SENTRY_ORG,
      projectSlug: project.slug,
      window: filters.window,
      environment: data.environment,
      // The sweep's problems stay in the request so they are returned alongside any new one; they
      // are already cached per problem, so including them costs nothing.
      subjects,
      model: resolveModel(url.searchParams.get('model')),
      effort: resolveEffort(url.searchParams.get('effort')),
      mode,
    }

    // Everything the ranking holds, so the panel can offer what the sweep left out. Sent with
    // both responses because it is derived from the same ranking the agent was pointed at.
    const candidates = rankedSubjects.map((subject) => ({
      key: subject.key,
      state: subject.state,
    }))

    // `peek=1` returns a cached analysis without ever starting a paid run, so the page can show
    // what it already has and only spend when the reader asks for it.
    if (url.searchParams.get('peek') === '1') {
      const hit = cachedAnalysis(agentRequest)
      return Response.json(
        { pending: hit === null, result: hit, candidates },
        { headers: { 'cache-control': 'no-store' } },
      )
    }

    if (agentRequest.subjects.length < agentConfig.minIssuesToAnalyse) {
      return Response.json(
        {
          pending: false,
          result: null,
          candidates,
          skipped: 'nothing above threshold to explain',
        },
        { headers: { 'cache-control': 'no-store' } },
      )
    }

    return Response.json(
      { pending: false, result: await analyseWithAgent(agentRequest), candidates },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    return failureResponse(error)
  }
}
