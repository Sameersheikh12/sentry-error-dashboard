import { failureResponse } from '../failure-response'
import { readDashboardRequest } from '../dashboard-request'
import { loadDashboard } from '@/lib/dashboard/load-dashboard'

export async function GET(request: Request) {
  try {
    const { filters, project } = await readDashboardRequest(request)
    return Response.json(await loadDashboard({ project, filters }))
  } catch (error) {
    return failureResponse(error)
  }
}
