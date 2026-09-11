import type { z } from 'zod'
import type { sentryIssueSchema, sentryProjectSchema } from './schemas'

export type SentryProject = z.infer<typeof sentryProjectSchema>
export type SentryIssue = z.infer<typeof sentryIssueSchema>
