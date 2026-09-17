---
name: triage
description: Read and investigate Sentry errors over the Sentry MCP connection. Two modes - sweep a project for what changed, or investigate a specific error, user or session and explain what the error actually says. Use when asked to triage, check errors, see what is broken, explain an error, find errors for a user, or search Sentry by any field.
---

# Sentry triage

Answer one question: **is anything happening right now that was not happening before?**

Sentry already lists errors and sorts them by volume. Volume is useless for triage — the loudest
error has usually been loud for weeks. Compare every issue against **its own recent history**
instead. That needs no list of "expected" errors, so nothing goes stale.

## Two modes — pick by what was asked

**Sweep** — "what's broken?", "anything new?", "triage <project>". No specific thing is named.
Follow the steps below.

**Investigate** — a specific issue, user, session, endpoint or tag is named: "what does this error
mean?", "show me every error for this user", "who else is hitting this?", "errors on Android".
**Read `investigate.md` in this directory and follow that instead.** It is the more common request,
and the one where reading the error properly matters most: the title is usually the least
informative field on the event.

If both apply — "what's broken, and why?" — sweep first, then investigate the top problem.

## Arguments for a sweep

`/triage <project> [window]` — e.g. `/triage indusind-pwa 24h`.
Window defaults to `24h`. Supported: `24h`, `7d`, `14d`, `30d` (the MCP's periods).
If no project is given, list projects with `find_projects` and ask which one.

## Step 1 — Get the numbers

Three calls. Use the org slug from `find_organizations` if you do not know it.

**Always filter the environment**, or production gets mixed with dev, qa, uat and sandbox and
every number is wrong. Default to `prod`; list a project's environments if unsure. Always request
`limit=100` — a truncated list silently loses the small issues, which are the ones most likely to
be new.

**Current window counts** (exact, structured JSON):
```
search_events(organizationSlug, projectSlug, dataset='errors', query='environment:prod',
              fields=['issue','count()'], sort='-count()', period=<window>, limit=100)
```

**Baseline counts** — the same call with the next period up (`24h`→`30d`, `7d`→`30d`,
`14d`→`90d`, `30d`→`90d`). These counts are period-scoped and *include* the current window, so:

```
baselineEvents = widerCount − currentCount
baselineHours  = widerHours − windowHours
baselineRate   = baselineEvents / baselineHours
currentRate    = currentEvents / windowHours
multiplier     = currentRate / baselineRate
```

**Issue metadata** for titles, culprits, users, first/last seen and substatus:
```
search_issues(organizationSlug, projectSlugOrId, query='is:unresolved environment:prod',
              sort='freq', period=<baseline period>, limit=100)
```

**The first-seen trap.** `search_issues` reports first-seen *relative to the period you asked for*.
Query 30 days and a two-year-old issue says "first seen 29 days ago". Never call something `NEW`
on that basis — check it against the longest period you can (`90d`), or fetch the issue itself
with `get_sentry_resource`, which carries the lifetime value. This one mistake made every issue
look brand new in the reference implementation before it was caught.

Two clamps on the baseline, both of which matter:
- **Never divide by time before the issue existed.** If an issue is 3 days old and the baseline
  period is 30 days, its baseline span is 3 days minus the window, not 30. Skipping this makes
  steady traffic look like a surge — it is the single easiest way to get this wrong.
- **Sentry keeps events for 90 days.** A baseline cannot reach further back than that.

If the usable baseline is under 24 hours, the issue has **no multiplier**. Say "no baseline",
never invent a number.

An issue present in the current window but absent from the wider one has no baseline — it is
probably new. But only conclude that if the wider list came back **under** the 100 limit; if it
was truncated, absence means nothing and you should say so.

## Step 2 — Cluster issues into problems

Sentry groups events into issues. It does **not** group issues into problems, and that is most of
the value here. On a real project 124 issues collapsed into 43 problems; one endpoint alone
accounted for 29 separate Sentry issues that were the same error.

Take the first key that actually **discriminates**:

1. **The API path inside the title.** `PWA Journey API Error: API exception at /journey/capture-event`
   → `/journey/capture-event`. This is usually the real signal; the culprit is only the page the
   user was on.
2. **The exception type**, unless it is generic (`Error`, `TypeError`, `SyntaxError`) or a wrapper
   that appears on every failure in the project (`PWA Journey API Error`, `UnhandledRejection`).
   Those describe nothing — fall through.
3. **The culprit**, with dynamic parts collapsed: `/journey/accounts/acc_ca_HYP…/emi` →
   `/journey/accounts/:id/emi`, and route steps merged (`/j/checkout:landing` → `/j/checkout`).
4. **The issue id**, as a last resort.

Ignore embedded identifiers and timestamps when comparing titles — ids like `usrj_a3208812a773aeec`
make every title unique. Do not print them either; they are customer identifiers with no
diagnostic value.

Say which key you grouped on, and flag a cluster whose members share nothing but that key — the
merge may be wrong and the reader should be able to judge it.

## Step 3 — Label each problem

Sum member events; take the **largest** member user count, never the sum (Sentry counts users per
issue and cannot de-duplicate across them, so a sum double-counts). Then, in order:

| Label | Test |
|---|---|
| `NEW` | The problem's earliest first-seen is inside the window |
| `REGRESSED` | Sentry marks it regressed, or it is resolved yet still firing |
| `SURGING` | multiplier ≥ **3×**, with at least **10** events in the window |
| `FADING` | No events now, after a baseline that predicted at least **10** |
| `CHRONIC` | Anything else still firing |

A problem is `NEW` only when the **problem** is new. A mature problem that grew one new member is
still mature — mention the new variant, do not promote the whole cluster, or the oldest and
largest problems float to the top.

Below **10 events** or **2 users**, list it separately as low signal rather than dropping it. A
headline that promises things worth looking at and delivers single-event noise teaches people to
stop reading. `FADING` is exempt — it is defined by having no events.

## Step 4 — Report

Lead with the verdict, then the problems worth attention, then the rest collapsed.

```
3 problems worth looking at · 17 background · 22 below threshold
compared against the previous 6 days · data as of <time>

SURGING  /journey/accounts/:accountId/emi-config        182 events  ≥171 users  25×
         usually <1/day over the 35 days since it appeared, now 6/day
         3 Sentry issues · grouped on api-path · INDUSIND-PWA-1J8 …

NEW      /journey/post-user-state                       214 events  ≥182 users   —
         first seen 4 days ago
```

Every row states **why** it is where it is, in words, with the numbers behind it. Nobody trusts a
ranking they cannot check.

Rules for the report:
- Never show a multiplier for something with no usable baseline, or with no events. Show `—`.
- Users are a floor for a group: write `≥171`, and say why if asked.
- If nothing qualifies, say "nothing new in the last <window>" — and say how many issues you
  scanned, so silence is distinguishable from a failed fetch.
- Link issues by short id so they can be opened in Sentry.

## Honest limits — state these if they affect the answer

- MCP periods are fixed (`24h`, `7d`, `14d`, `30d`, `90d`), so the baseline is a subtraction
  between two of them rather than an exact custom range.
- Results cap at 100 issues per call with no pagination. If a project has more, say the ranking
  covers a subset.
- The issue list carries no release data, so you cannot attribute a surge to a deploy from here.
- `REGRESSED` needs a previously resolved issue. If a team never resolves anything, that label
  will never appear — which is not the same as the detection being broken. Say so rather than
  leaving a silent zero.

## When a sweep result needs explaining

A label says *that* something changed, never *why*. As soon as anyone asks why — or when you report
a `NEW` or `SURGING` problem and the reason is not obvious — switch to `investigate.md` and read the
actual event. The upstream error is usually attached to it, and it is usually the answer.

## Reference implementation

`src/lib/analysis/` in this repo implements these rules deterministically, with 100 unit tests —
useful when you want to check a judgement call, or when a number here looks wrong.
`README.md` records the Sentry API behaviours that each caused a real bug, including the big one:
`firstSeen` is scoped to the query range, so an issue first seen in 2024 reports today's date in a
24-hour query. Use lifetime first-seen for `NEW`, or everything looks brand new.
