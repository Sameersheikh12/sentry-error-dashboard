import { failureResponse } from '../failure-response'
import { fetchProjects } from '@/lib/sentry/client'

export async function GET() {
  try {
    const { items, truncated, fetchedAt } = await fetchProjects()
    return Response.json({
      fetchedAt: fetchedAt ?? new Date().toISOString(),
      truncated,
      projects: items,
    })
  } catch (error) {
    return failureResponse(error)
  }
}
