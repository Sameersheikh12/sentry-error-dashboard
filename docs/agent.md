# The Claude agent

The dashboard does two jobs, kept deliberately separate:

| Job | Done by | Why |
|---|---|---|
| Rank problems (events, rate, baseline) | `src/lib/analysis/` — plain TypeScript | Arithmetic. Instant, unit-tested, can't hallucinate a multiplier |
| Explain what an error means | `src/lib/agent/` — spawns local Claude Code | Requires opening the actual event, which arithmetic can't do |

Sentry's title is usually the least informative field on an event —
`PWA Journey API Error: API exception at /journey/fetch-user-info` just says a call failed. The
`extra.logs` on that same event says `411 — No Journey found with User Journey ID`, across 12,432
occurrences. The dashboard aggregates titles; the agent opens the event.

```
browser → /api/agent → loadDashboard()   ranks problems (deterministic)
                     → runClaude()       spawn: claude -p --output-format json
                          └→ Sentry MCP  reads the actual events
                     ← JSON, validated, scrubbed, cached per problem
```

## Setup

There is **no Claude token** and nothing to paste into `.env.local`. The app spawns the `claude`
binary as a subprocess, which authenticates as whoever is logged in on that machine.

1. **Install Claude Code** — <https://claude.com/claude-code>
2. **Log in** — run `claude`, complete the browser sign-in. Writes an OAuth token to
   `~/.claude/.credentials.json`. Usage bills to your Claude subscription, not to this app.
3. **Connect Sentry** — claude.ai → Settings → Connectors → add Sentry, authorise the org. This is
   an account-level connector, not something configured in this repo — check with `/mcp`.
4. **Make the binary findable** — auto-detected in `~/.local/bin`, `~/.claude/local`,
   `/usr/local/bin`, and the VS Code extension directory. Otherwise set `CLAUDE_CLI_PATH`.

Missing any of this degrades gracefully: the table, ranking and chart are unaffected. Only the
agent panel shows an error explaining what's missing — see [Troubleshooting](../README.md#troubleshooting).

## What it's allowed to do

`--allowedTools`: `Read` plus three read-only Sentry MCP tools. Nothing else — no writes to
Sentry, no shell, no filesystem beyond a read. Two things are enforced in code, not just asked for
in the prompt (tested in `src/test/security/agent-analysis.test.ts`):

- **Keys are assigned, never echoed.** A run once returned a Sentry short id instead of the key it
  was given — right answer, wrong label. Subjects are numbered; the reply is matched by index.
- **Every free-text field is scrubbed** through the same identifier-scrubber used on titles. A run
  told not to include identifiers still returned one.

## The panel

- **Verdict** stays open — it's the answer.
- Each finding: state badge, key, the **upstream error verbatim** (three scannable in three
  lines), then the plain-English explanation behind a *what this means* disclosure.
- **"N more ranked problems not read yet"** — pick any and read them together. One run for three
  costs $0.074/30s vs. $0.205/97s for three separate runs (measured) — a run has fixed overhead
  regardless of how much it covers.
- Reading doesn't hide what's already found: new picks show as dashed `reading the event…`
  placeholders *under* the finished findings, not instead of them.
- **Ask about this error** opens a thread scoped to one problem — "who else hits this", "when did
  it start". Off-topic questions get told so, not answered. Capped at 6 turns of history.
  Cancellable at any point; a cancelled question returns to the input box, editable.

## Cost

Model is the biggest lever, effort the second. Measured on the same view:

| Setting | Cost | Time |
|---|---|---|
| opus, max effort | $0.48 | 31s |
| sonnet, low effort | $0.285 | 23s |
| **haiku, low effort (default)** | **$0.075** | 31s |

Reading a field out of an event and restating it isn't a reasoning task — haiku isn't a
compromise, it found the same root causes every time it was measured against opus.

Switch per-request in the panel's Model/Effort dropdowns (not in the URL — they change who
answers, not what's shown, so switching costs no reload). Switch the default via
`CLAUDE_AGENT_MODEL` / `CLAUDE_AGENT_EFFORT`, or `agent.config.ts`. Values are checked against an
allowlist server-side before reaching the spawned process — an unrecognised value falls back to
the default rather than passing through.

## Caching and spend limits

- **Findings are cached per problem**, not per set of problems — adding a 4th problem to an
  analysed set of 3 pays for the 1 new one, not all 4. Re-requesting anything already read costs
  $0.000.
- Cached 15 minutes, keyed by view (org/project/window/env/model/effort). Refresh is free;
  changing a filter buys a fresh read; **Re-analyse** forces one.
- Concurrent requests for the same view (a double-click, two tabs) coalesce into one run rather
  than both paying.
- A budget (`CLAUDE_AGENT_BUDGET_USD`, default $5) stops new spending at 65% used. Past that, the
  panel reports the limit; the ranking, table and chart are unaffected — they never needed the
  agent. Resets on server restart (in-memory, like the rest of the agent layer).

## Also usable as a Claude Code skill

`.claude/skills/triage/` — no server, no token, no UI:

- **Sweep** (`SKILL.md`) — "what's broken in indusind-pwa?"
- **Investigate** (`investigate.md`) — "what does this error mean?", "show every error for this
  user". Reconstructs one user's session from `user.id`, which the aggregate view discards.

Same thresholds as `src/lib/config/analysis.config.ts` — update both if you change one.
