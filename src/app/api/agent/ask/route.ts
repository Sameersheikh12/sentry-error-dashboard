import { failureResponse } from '../../failure-response'
import { readDashboardRequest } from '../../dashboard-request'
import { askAboutProblem, askRequestSchema } from '@/lib/agent/ask'
import { budgetStatus } from '@/lib/agent/budget'
import { resolveEffort, resolveModel } from '@/lib/config/agent.config'
import { serverEnvironment } from '@/lib/config/env'
import { SentrySchemaError } from '@/lib/sentry/errors'

/**
 * A follow-up question about one problem the sweep already analysed.
 *
 * POST rather than GET because the body carries a question and a short history, and because this
 * always spends — there is nothing here to cache. The problem context comes from the client, but
 * the org, project and window are re-derived from the query string server-side, so a caller cannot
 * point the agent at a project the dashboard is not showing.
 */
export async function POST(request: Request) {
  try {
    const { filters, project } = await readDashboardRequest(request)

    const parsed = askRequestSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw new SentrySchemaError(
        parsed.error.issues[0]?.path.join('.') || 'body',
        parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      )
    }

    const result = await askAboutProblem(
      {
        ...parsed.data,
        model: resolveModel(parsed.data.model),
        effort: resolveEffort(parsed.data.effort),
      },
      {
        organization: serverEnvironment().SENTRY_ORG,
        projectSlug: project.slug,
        window: filters.window,
        environment: filters.environment ?? 'prod',
      },
    )

    const budget = budgetStatus()
    return Response.json(
      { result, budget: { fractionUsed: budget.fractionUsed, exhausted: budget.exhausted } },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    return failureResponse(error)
  }
}
