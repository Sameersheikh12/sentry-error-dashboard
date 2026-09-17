# How ranking works

No list of "expected errors" exists anywhere in this repo, on purpose — it would go stale and
silently make the dashboard lie. Every issue is compared **against its own recent history**
instead, which Sentry already stores and which can't go stale.

## Classification

Issues cluster into **problems** first. Every number shown — events, users, rate, multiplier,
score — comes from one aggregate object, so the prose and the columns can't disagree.

**The baseline**, clamped twice:

```
baselineStart = max(windowStart − window × baselineMultiplier, problem.firstSeen, retentionFloor)
baselineRate  = baselineEvents / (windowStart − baselineStart)
```

- Clamped to the **problem's own age** — a 2-week-old issue divided by 180 days of baseline reads
  steady traffic as a surge.
- Clamped to **Sentry's 90-day retention** — a longer baseline divides by a period with no data.

Too short a baseline, or no events in the window → **no multiplier**, a dash rather than a
fabricated number.

| State | When | Meaning |
|---|---|---|
| `NEW` | the *problem's* earliest `firstSeen` is inside the window | Never seen before |
| `REGRESSED` | a member is marked regressed, or resolved yet still firing | Fixed, came back |
| `SURGING` | multiplier ≥ `surgeMultiplier`, ≥ `minEventFloor` events | Behaving abnormally |
| `FADING` | silent now, after a baseline big enough for silence to matter | A fix landed |
| `CHRONIC` | everything else | Background noise |

A problem is `NEW` only when the *problem* is new — one new member in a mature cluster gets a
**new variant** marker, not a promotion, or the oldest problems float to the top forever.

Below `minEventFloor` / `minUserFloor` → filed as "below threshold", kept but demoted. `FADING` is
exempt (it's defined as zero events; a floor would reject every one).

## Grouping

First extractor that yields something **discriminating** wins:

1. API path from the title → 2. exception type → 3. normalized culprit → 4. issue id

`wrapperTypePrefixes` (identical on every failure, e.g. `PWA Journey API Error`) and
`genericTypeNames` (`Error`, `TypeError`) fall through to the next extractor.

```
/journey/accounts/acc_ca_HYPmFOnLGHIID570ovj/emi  →  /journey/accounts/:id/emi
/j/transaction-to-emi:landing                     →  /j/transaction-to-emi
```

Titles are scrubbed of ids/timestamps before grouping *or display* — `snake_case` words are left
alone (an id has digits or mixed case; `checkout_session` doesn't). Each problem shows which
extractor produced its key, flagged **loose grouping** if members share nothing else.
`?grouping=none` gives one row per Sentry issue, to check grouping isn't hiding anything.

## On screen

Verdict headline → overview band (events/users, period deltas) → volume chart → one table (state,
problem, users, events, rate, sparkline, last seen). Chronic and below-threshold rows collapse;
nothing is hidden, only ordered.

Applied filters show as removable chips (generated from the same object that produces the count —
can't be counted without being removable) plus **Clear all**. Two text boxes do different things:
**filter rows by text** narrows what's already loaded (local, free); **release** changes the
Sentry query (the issue list carries no release field, so this can't be done client-side).

Every filter lives in the URL:

```
/?project=indusind-pwa&env=prod&window=24h&state=new,surging&sort=score
```

`window` (`1h`/`6h`/`24h`/`7d`/`14d`/`30d` or a UTC range), `level`, `release`, `q`, `grouping`,
`chart=off`. Environment defaults to the first name in `environmentPreference` the project
actually has — defaulting to one that doesn't exist would render a falsely calm empty page.

A **"How these labels are decided"** disclosure and a **diagnostics panel** (`/api/diagnostics`)
both read straight from `analysis.config.ts`, so they quote the thresholds actually in force
rather than a description that can drift.

## Sentry API facts (verified against a live org — each caused a real bug)

- **`firstSeen` is scoped to the query range.** A 2024 issue reports today's date in a 24h query.
  `NEW` uses `lifetime.firstSeen`, also **environment-scoped**.
- **`count`/`userCount` are range-scoped too** — the window and baseline are separate queries, not
  one range and a subtraction.
- **Retention is 90 days** (a slice at 90d back returns events; at 91d, none).
- `groupStatsPeriod=auto` with an explicit range returns ~30 buckets regardless of span — nothing
  here fabricates buckets. Empty `groupStatsPeriod=` drops the series but keeps counts;
  `collapse=stats` also drops `count`.
- Issue list has **no release field** — filterable, not displayable.
- `count` arrives as a string, coerced in the schema layer.
- Window boundaries snap to the cache bucket, or the URL changes every second and the cache never
  hits.
- **`REGRESSED` can't fire on this org** — zero resolved issues exist. Detection is tested; it's
  idle, not broken.
