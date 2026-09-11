import { failureResponse } from '../failure-response'
import { readDashboardRequest } from '../dashboard-request'
import { loadDashboard } from '@/lib/dashboard/load-dashboard'

// A state that never appears is indistinguishable from a state whose detection is broken. This
// reports what every branch actually saw, unfiltered.
export async function GET(request: Request) {
  try {
    const { filters, project } = await readDashboardRequest(request)
    const data = await loadDashboard({ project, filters })

    return Response.json({
      project: data.project,
      environment: data.environment ?? '(all environments)',
      availableEnvironments: data.availableEnvironments,
      window: { start: data.windowStart, end: data.windowEnd, hours: data.windowHours },
      baseline: data.baseline,
      problemsAboveThreshold: data.problems.length,
      problemsBelowThreshold: data.lowSignalProblems.length,
      violations: data.violations,
      ...data.diagnostics,
    })
  } catch (error) {
    return failureResponse(error)
  }
}
