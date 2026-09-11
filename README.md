# Sentry Triage

A dashboard that answers one question: **is anything happening right now that wasn't happening before?**

Sentry already lists your errors. This ranks them, so that when something breaks you see it in
seconds instead of scrolling past forty chronic failures that have been firing for weeks.

## The idea

There is no list of "expected errors" anywhere in this repo, and there must not be one — any such
list goes stale and silently makes the dashboard lie.

Instead every issue is compared **against its own recent history**, which Sentry already stores.
An error running at 200/day for a month is expected; the data says so. One whose first event was
twenty minutes ago is not. That comparison needs no external input and cannot go stale.

## Run it

Needs Node 20+.

```bash
npm install
cp .env.example .env.local     # fill in the first two
npm run dev
```

| Variable | Required | Meaning |
|---|---|---|
| `SENTRY_AUTH_TOKEN` | yes | Token with `project:read` and `event:read` |
| `SENTRY_ORG` | yes | Org slug as it appears in Sentry URLs |
| `SENTRY_API_BASE_URL` | no | Defaults to `https://sentry.io`; some orgs need `us.`/`de.` |
| `SENTRY_DEFAULT_PROJECT` | no | Numeric project id to open by default |

Commands: `npm run dev` · `npm run build` · `npm test` · `npm run lint` · `npm run typecheck`

CI runs all four on every push and pull request. The build step deliberately runs **without
secrets** — that is what keeps the app buildable from a clean clone.

## How a problem is classified

Issues are clustered into **problems** first. Every number shown for a problem — events, users,
rate, multiplier, score, and the sentence explaining it — comes from one aggregate object, so the
prose and the columns cannot disagree. A single issue is just an aggregate of one.

**The baseline is the whole trick**, and it is clamped twice:

```
baselineStart = max(windowStart − window × baselineMultiplier, problem.firstSeen, retentionFloor)
baselineRate  = baselineEvents / (windowStart − baselineStart)
```

- Clamped to the **problem's own age**, or a two-week-old issue gets divided by 180 days of
  baseline and steady traffic reads as a surge.
- Clamped to **Sentry's 90-day retention**, because a baseline reaching further back divides by a
  period Sentry has no data for.

If the usable baseline is too short, or the window had no events, there is **no multiplier** — the
rate column shows a dash rather than a fabricated number.

| State | When | Meaning |
|---|---|---|
| `NEW` | the *problem's* earliest `firstSeen` is inside the window | Never seen before |
| `REGRESSED` | a member is marked regressed, or is resolved yet still firing | Fixed, and it came back |
| `SURGING` | multiplier ≥ `surgeMultiplier`, with at least `minEventFloor` events | Behaving abnormally |
| `FADING` | silent now, after a baseline big enough for silence to mean something | A fix landed |
| `CHRONIC` | everything else | Background noise |

A problem is `NEW` only when the *problem* is new. One new member inside a mature cluster gets a
**new variant** marker, not a promotion — otherwise the oldest, largest problems float to the top.

Problems below `minEventFloor` events or `minUserFloor` users are kept but filed under "below
threshold", so the headline count means something. `FADING` is exempt: it is defined as zero
events, so a floor would reject every one.

## Grouping

The key comes from the first extractor that yields something **discriminating**:

1. API path from the title → 2. exception type → 3. normalized culprit → 4. issue id

Two config lists keep keys meaningful: `wrapperTypePrefixes` (a type that's identical on every
failure, e.g. `PWA Journey API Error`) and `genericTypeNames` (`Error`, `TypeError` — describe
nothing). Either one falls through to the next extractor.

Normalization collapses dynamic segments, so one endpoint is one problem:

```
/journey/accounts/acc_ca_HYPmFOnLGHIID570ovj/emi  →  /journey/accounts/:id/emi
/j/transaction-to-emi:landing                     →  /j/transaction-to-emi
```

Titles are scrubbed of embedded ids and timestamps before grouping *or display* — they'd otherwise
make every title unique and leak customer identifiers into screenshots. Ordinary `snake_case`
words are deliberately left alone (an id carries digits or mixed case; `checkout_session` doesn't).

Each problem shows the key it formed on and which extractor produced it, and is flagged **loose
grouping** when its members share no wording beyond that key. `?grouping=none` gives one row per
Sentry issue — that's how you check whether grouping is helping or hiding.

## On screen

A verdict headline, an overview band (events/users with period-over-period deltas), a volume chart
stacked by the top problems, and one table: state, problem, users, events, rate, sparkline, last
seen. Chronic and below-threshold problems collapse into disclosures. Nothing is ever hidden, only
ordered.

Every filter lives in the URL, so a link reproduces the view exactly:

```
/?project=indusind-pwa&env=prod&window=24h&state=new,surging&sort=score
```

Windows are `1h`/`6h`/`24h`/`7d`/`14d`/`30d` or an absolute UTC range. Also `level`, `release`,
`q` (text search), `grouping`, and `chart=off`. Environment defaults to the first name in
`environmentPreference` the project actually has — Sentry environments are project-defined, and
defaulting to one that doesn't exist would render an empty, falsely calm page.

A **diagnostics panel** (and `/api/diagnostics`) reports the state distribution across every issue
scanned, which extractor produced each key, and why any state didn't fire — a state that never
appears is otherwise indistinguishable from one that's broken.

## Architecture

```
src/lib/sentry/       transport only: fetch, retry, paginate, validate, redact, typed errors
src/lib/analysis/     pure: aggregate, classify, group, extract, score, timeline, invariants
src/lib/dashboard/    joins the two: adapter, URL filters, load-dashboard
src/lib/config/       every tunable; env parsing; startup guards
src/components/       presentation
src/test/            93 unit tests: the analysis layer, plus the security and URL modules
```

Three rules hold it together:

1. **The token never reaches the browser.** Every Sentry call is server-side; the built bundle is
   grepped for the token as a check.
2. **`lib/analysis` is pure** — no fetch, no React, no env, no clock (time arrives as an argument).
   A wrong classification looks exactly like a right one, so this is the part that's tested.
3. **`lib/sentry` only moves bytes.** It doesn't classify, group or rank.

## Sentry API facts worth knowing

All verified against a live org, not assumed — each one caused a real bug:

- **`firstSeen` is scoped to the query range.** An issue first seen in 2024 reports today's date in
  a 24h query. `NEW` uses `lifetime.firstSeen`, which is also **environment-scoped**.
- **`count` and `userCount` are range-scoped too** — which is why the current window and the
  baseline are two separate queries rather than one range and a subtraction.
- **Event retention is 90 days** (a 1-day slice at 90d back returns events; at 91d, none).
- **Bucket granularity is Sentry's choice**: `groupStatsPeriod=auto` with an explicit range returns
  ~30 buckets whatever the span. Nothing here fabricates buckets.
- `groupStatsPeriod=` (empty) drops the series but keeps the counts. `collapse=stats` can't be used
  — it drops `count` as well.
- The issue list carries **no release field**, so release can be filtered but not displayed.
- `count` arrives as a string; it's coerced in the schema layer.
- Window boundaries are snapped to the cache bucket, or the URL changes every second and the
  response cache never hits.

**`REGRESSED` cannot currently fire on this org** — there are zero resolved issues across all
projects, and a regression requires one. Detection is unit-tested; it's idle, not broken.

## Configuration

Every threshold, weight and skip-list lives in `src/lib/config/analysis.config.ts`; transport
settings (query, page size, timeout, retry policy) in `sentry.config.ts`. No literal thresholds
appear anywhere else.

The ones worth tuning first: `surgeMultiplier` (3), `minEventFloor` (10), `minUserFloor` (2),
`baselineMultiplier` (6 — note retention caps this at the 14d and 30d windows), `cacheSeconds` (60),
and the `wrapperTypePrefixes` / `genericTypeNames` lists, which need extending per project.

## Failure behaviour

Every failure is typed and carries a stable `code`, a safe `userMessage`, a verbose `devDetail`
(withheld in production) and a `correlationId` that also appears on screen. `429` and `5xx` are
retried with backoff honouring `Retry-After`; `4xx` never is. Pagination refuses to follow a
`Link` header to another origin, because the token goes with it.

**An empty dashboard is never reachable through failure.** "No problems found" and "could not
fetch" are visually distinct with different copy, and the calm state is never rendered on an error
path. Nothing falls back to fixtures or an empty array. The timestamp shown is Sentry's own `Date`
header, so a cached render shows its true age.

Invariants run over every row (`users ≤ events`, `lastSeen` inside the window). A row that fails
one is withheld and logged rather than displayed — a wrong number here is indistinguishable from a
right one.

The claims in this section and the next are covered by tests in `src/test/security/`, so they can
be checked by running the suite rather than by reading the code.

## Security

**This app has no authentication and holds a token that can read your whole organisation's error
data.** Fine on a laptop, not fine on a reachable host.

It **refuses to start** in production unless `DASHBOARD_ACCESS_SECRET` is set or
`ALLOW_UNAUTHENTICATED=true` is set deliberately (which shows a permanent warning banner). When the
secret is set, `proxy.ts` gates every request. Startup also asserts no `NEXT_PUBLIC_*` variable
looks like a credential. One `redact()` scrubs credentials from anything logged or serialized, and
upstream response bodies never reach the client. Sentry titles are untrusted text: nothing uses
`dangerouslySetInnerHTML`, text is length-clamped, and a `permalink` becomes a link only when it's
`https` on the expected Sentry host.

## Not built, on purpose

No database, no writes to Sentry, no alerting (alert fatigue is the problem being solved), no user
accounts, no charting library — the sparklines and timeline are inline SVG from data already
fetched.
