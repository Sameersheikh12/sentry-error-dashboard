import { fetchProjects } from '@/lib/sentry/client'

/** What the dashboard needs to offer a project picker — not Sentry's full project shape. */
export interface ProjectOption {
  id: string
  slug: string
}

export async function loadProjects(): Promise<ProjectOption[]> {
  const { items } = await fetchProjects()
  return items
    .map((project) => ({ id: project.id, slug: project.slug }))
    .sort((left, right) => left.slug.localeCompare(right.slug))
}

/**
 * Slug first — a shared link should be readable — then the configured default, then the first.
 * An explicit slug that matches nothing resolves to nothing rather than quietly substituting a
 * different project: showing someone another project's errors under the URL they typed is worse
 * than telling them the name was wrong.
 */
export function resolveProject(
  projects: ProjectOption[],
  slug: string | undefined,
  defaultProjectId: string | undefined,
): ProjectOption | undefined {
  if (slug) return projects.find((project) => project.slug === slug)

  return projects.find((project) => project.id === defaultProjectId) ?? projects[0]
}
