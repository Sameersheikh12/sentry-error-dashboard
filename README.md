# Sentry Triage

A local Claude Code agent reads your Sentry errors and tells you what they actually mean — the
upstream cause, usually buried in `extra.logs` and never in the title. Problems are ranked by
**what changed**, not by volume, so the agent reads the ones worth its time first.

## Requirements

This is not a Sentry viewer with an extra panel bolted on — reading the actual error, not just
ranking it, is the point of the project. Both of these are required:

- Node 20+ and a Sentry auth token (`project:read`, `event:read`)
- [Claude Code](https://claude.com/claude-code) installed and logged in, with the Sentry MCP
  connector enabled — see [docs/agent.md](docs/agent.md#setup)

## Quick start

```bash
npm install
cp .env.example .env.local     # fill in SENTRY_AUTH_TOKEN and SENTRY_ORG
npm run dev
```

Open `http://localhost:3000`. Both requirements above need to be met for this to be what it's
meant to be — the ranking is only half the value; the agent reading the actual event is the other
half, and the reason this exists instead of a Sentry saved search.

If the agent isn't reachable (Claude not installed, not logged in, MCP not connected), the page
doesn't go blank — the ranking and chart still render, and the panel names exactly what's missing
instead of failing silently. That's a resilience property, not a suggestion that the agent is
optional. See [Troubleshooting](#troubleshooting).

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `SENTRY_AUTH_TOKEN` | yes | Token with `project:read` + `event:read` |
| `SENTRY_ORG` | yes | Org slug, as it appears in Sentry URLs |
| `SENTRY_API_BASE_URL` | no | Defaults to `https://sentry.io`; some orgs need `us.`/`de.` |
| `SENTRY_DEFAULT_PROJECT` | no | Numeric project id to open by default |
| `CLAUDE_CLI_PATH` | no | Path to `claude`, if not in a standard location |
| `CLAUDE_AGENT_MODEL` | no | Agent model. Defaults to `haiku` — see [docs/agent.md](docs/agent.md#cost) |
| `CLAUDE_AGENT_EFFORT` | no | Agent effort. Defaults to `low` |
| `CLAUDE_AGENT_BUDGET_USD` | no | Spend ceiling before the agent stops. Defaults to `5` |
| `DASHBOARD_ACCESS_SECRET` | no\* | Shared secret gating access — see [Security](#security) |
| `ALLOW_UNAUTHENTICATED` | no\* | `true` to run with no access gate (shows a warning banner) |

\*One of these two is **required in production**; the app refuses to start without it.

There is **no Claude token to set** — see [docs/agent.md](docs/agent.md) for why.

## Commands

```
npm run dev · npm run build · npm test · npm run lint · npm run typecheck
```

CI runs all four on every push. `build` deliberately runs without secrets — that's what proves the
app builds from a clean clone.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Agent panel: *"Local Claude Code was not found…"* | Binary not in a discovered path | Install Claude Code, or set `CLAUDE_CLI_PATH` |
| Agent panel: *"...reported an error while analysing"* | Claude ran but failed (bad auth, MCP not connected) | Run `claude` directly and check `/mcp` lists Sentry |
| Agent panel: *"...did not finish within Ns"* | Agent run exceeded `timeoutMs` | Usually transient; retry. Persistent → check network to Sentry |
| Agent panel: *"Spend limit reached: $X spent…"* | Hit 65% of `CLAUDE_AGENT_BUDGET_USD` | Raise the env var, or restart the server (resets in-memory) |
| Dashboard: *"Sentry rejected the credentials"* | `SENTRY_AUTH_TOKEN` expired/revoked | Issue a new token with `project:read` + `event:read` |
| Dashboard: *"No project matching this selection"* | Wrong org, or token can't see that project | Check `SENTRY_ORG` and the token's project access |
| Dashboard: *"Sentry rate limit reached"* | Too many requests in a short window | Retried automatically with backoff; wait if it persists |
| Dashboard: *"Could not reach Sentry"* | Network issue, or wrong region | Check connectivity and `SENTRY_API_BASE_URL` |
| App won't start in production | Neither `DASHBOARD_ACCESS_SECRET` nor `ALLOW_UNAUTHENTICATED` set | Set one — see [Security](#security) |

Every error carries a `correlationId` shown on screen — grep the server log for it to find the
full `devDetail` (withheld from the client in production).

## How it works

- **A local Claude Code agent reads the real event** — `src/lib/agent/`, over the Sentry MCP,
  because the title is usually the least informative field on it. This is what the project is
  for. Details, setup, cost and caching: [docs/agent.md](docs/agent.md).
- **Ranking is deterministic** — `src/lib/analysis/`, pure TypeScript, 100+ unit tests, no
  external "expected errors" list to go stale. It exists so the agent is told what to read instead
  of burning turns rediscovering it. Details: [docs/ranking.md](docs/ranking.md).
- **Also usable as a Claude Code skill** with no server at all —
  [docs/agent.md#also-usable-as-a-claude-code-skill](docs/agent.md#also-usable-as-a-claude-code-skill).

## Architecture

```
src/lib/sentry/       transport only: fetch, retry, paginate, validate, redact, typed errors
src/lib/analysis/     pure: aggregate, classify, group, extract, score, timeline, invariants
src/lib/agent/        spawns local Claude Code headlessly; validates and scrubs what comes back
src/lib/dashboard/    joins the two: adapter, URL filters, load-dashboard
src/lib/config/       every tunable; env parsing; startup guards
src/components/       presentation
src/test/             unit tests: analysis layer, security and URL modules
```

1. **The Sentry token never reaches the browser** — every call is server-side; the built bundle
   is grepped for the token as a check.
2. **`lib/analysis` is pure** — no fetch, React, env or clock (time is an argument). A wrong
   classification looks exactly like a right one, so this is the part that's tested.
3. **`lib/sentry` only moves bytes** — no classifying, grouping or ranking.

Tunable thresholds live in `src/lib/config/analysis.config.ts` (`surgeMultiplier`,
`minEventFloor`, `minUserFloor`, `baselineMultiplier`, `cacheSeconds`, and the
`wrapperTypePrefixes` / `genericTypeNames` lists) — nothing is hardcoded elsewhere.

## Failure behaviour

Every failure is typed: a stable `code`, a safe `userMessage`, a verbose `devDetail` (withheld in
production), a `correlationId` shown on screen. `429`/`5xx` retry with backoff; `4xx` never does.
An empty dashboard is never reachable through failure — "no problems found" and "could not fetch"
are visually distinct, and nothing falls back to fixtures or an empty array.

## Security

**This app has no authentication and holds a token that can read your whole org's error data** —
fine on a laptop, not fine on a reachable host. It refuses to start in production unless
`DASHBOARD_ACCESS_SECRET` or `ALLOW_UNAUTHENTICATED=true` is set. `redact()` scrubs credentials
from everything logged; Sentry titles are untrusted text (no `dangerouslySetInnerHTML`, links only
to `https` + the expected Sentry host). Claims here are covered by `src/test/security/`.

## Not built, on purpose

No database, no writes to Sentry, no alerting, no user accounts, no charting library — sparklines
and the timeline are inline SVG from data already fetched.
