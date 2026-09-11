import { z } from 'zod'

// This layer validates shape and type, not vocabulary. Fields like status, substatus and level
// are open enums that Sentry extends over time; a value we have not seen is not a breaking API
// change and must not take the whole fetch down. lib/analysis interprets those strings.

const isoTimestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), 'expected an ISO-8601 timestamp')

// Sentry serialises event counts as strings on the issues endpoint.
const eventCount = z.coerce.number().int().nonnegative()

/** [unixSeconds, eventCount] */
const statsBucket = z.tuple([z.number(), z.number()])

export const sentryProjectSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  platform: z.string().nullish(),
})

export const sentryIssueSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  title: z.string(),
  culprit: z.string().nullish(),
  permalink: z.string(),
  count: eventCount,
  userCount: eventCount,
  firstSeen: isoTimestamp,
  lastSeen: isoTimestamp,
  level: z.string().nullish(),
  status: z.string(),
  substatus: z.string().nullish(),
  metadata: z
    .object({
      type: z.string().nullish(),
      value: z.string().nullish(),
      filename: z.string().nullish(),
      function: z.string().nullish(),
    })
    .optional(),
  /**
   * Lifetime values, unscoped by the query range. Sentry scopes top-level firstSeen/lastSeen to
   * the requested start/end, so a two-year-old issue reports today's date in a 24h query — which
   * would make every issue look brand new.
   */
  lifetime: z
    .object({
      firstSeen: isoTimestamp.nullish(),
      lastSeen: isoTimestamp.nullish(),
    })
    .optional(),
  project: z
    .object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
    })
    .optional(),
  /**
   * Keyed by the requested groupStatsPeriod and holding exactly that one key — Sentry serialises
   * this as `{stats_period: series}`. "24h" yields 24 hourly buckets, "14d" yields 14 daily ones,
   * so a current window and a long baseline cannot come from the same request.
   */
  stats: z.record(z.string(), z.array(statsBucket)).optional(),
})

export const sentryEnvironmentSchema = z.object({
  id: z.string(),
  name: z.string(),
})
