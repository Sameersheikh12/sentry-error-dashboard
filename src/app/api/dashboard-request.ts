import { serverEnvironment } from '@/lib/config/env'
import { parseFilters, type DashboardFilters } from '@/lib/dashboard/filters'
import { loadProjects, resolveProject, type ProjectOption } from '@/lib/dashboard/load-projects'
import { SentryNotFoundError } from '@/lib/sentry/errors'

export interface DashboardRequest {
  filters: DashboardFilters
  project: ProjectOption
}

/** Both dashboard routes need the same thing: filters from the URL and a project to apply them to. */
export async function readDashboardRequest(request: Request): Promise<DashboardRequest> {
  const filters = parseFilters(Object.fromEntries(new URL(request.url).searchParams))
  const projects = await loadProjects()
  const project = resolveProject(
    projects,
    filters.projectSlug,
    serverEnvironment().SENTRY_DEFAULT_PROJECT,
  )

  if (!project) {
    throw new SentryNotFoundError(
      'No project matching this selection in this organization.',
      `Requested slug ${filters.projectSlug ?? '(none)'}; the organization returned ${projects.length} projects.`,
    )
  }

  return { filters, project }
}
