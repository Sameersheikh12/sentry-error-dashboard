export interface IssuesQueryParams {
  /** Numeric Sentry project id. The organization issues endpoint filters on ids, not slugs. */
  projectId: string
  start: Date
  end: Date
  environment?: string
  query: string
  sort: string
  limit: number
  /**
   * Ask for the event series. An empty groupStatsPeriod omits it while still returning count and
   * userCount for the range, which is everything the baseline call needs.
   */
  withStats: boolean
}

// Sentry accepts a naive ISO timestamp and reads it as UTC.
function sentryTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19)
}

function organizationPath(baseUrl: string, organization: string, resource: string): string {
  return `${baseUrl}/api/0/organizations/${encodeURIComponent(organization)}/${resource}/`
}

export function projectsEndpoint(baseUrl: string, organization: string): string {
  return organizationPath(baseUrl, organization, 'projects')
}

export function environmentsEndpoint(
  baseUrl: string,
  organization: string,
  projectSlug: string,
): string {
  return `${baseUrl}/api/0/projects/${encodeURIComponent(organization)}/${encodeURIComponent(projectSlug)}/environments/`
}

export function issuesEndpoint(
  baseUrl: string,
  organization: string,
  params: IssuesQueryParams,
): string {
  const search = new URLSearchParams({
    project: params.projectId,
    start: sentryTimestamp(params.start),
    end: sentryTimestamp(params.end),
    groupStatsPeriod: params.withStats ? 'auto' : '',
    query: params.query,
    sort: params.sort,
    limit: String(params.limit),
  })

  if (params.environment) search.set('environment', params.environment)

  return `${organizationPath(baseUrl, organization, 'issues')}?${search}`
}
