import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { agentConfig } from '@/lib/config/agent.config'
import {
  ConfigError,
  SentryTimeoutError,
  SentryUpstreamError,
} from '@/lib/sentry/errors'

/**
 * Runs the local Claude Code binary headlessly and returns its final text.
 *
 * This is what makes the dashboard agent-powered rather than a second Sentry UI: the analysis is
 * produced by Claude reading Sentry over MCP, not by this process computing it.
 */

/**
 * The VS Code extension carries a version in its path, so the binary is found, not hardcoded.
 *
 * The `turbopackIgnore` comments below are deliberate: these paths are outside the project and only
 * knowable at runtime, so there is nothing for the bundler to trace. Without them it warns that it
 * must trace the whole project, which is both slow and pointless here.
 */
function discoverBinary(): string | null {
  if (
    process.env.CLAUDE_CLI_PATH &&
    existsSync(/* turbopackIgnore: true */ process.env.CLAUDE_CLI_PATH)
  ) {
    return process.env.CLAUDE_CLI_PATH
  }

  const home = process.env.HOME ?? ''
  const fixed = [
    join(home, '.local/bin/claude'),
    join(home, '.claude/local/claude'),
    '/usr/local/bin/claude',
  ]
  for (const candidate of fixed) {
    if (existsSync(/* turbopackIgnore: true */ candidate)) return candidate
  }

  const extensions = join(home, '.vscode/extensions')
  if (!existsSync(/* turbopackIgnore: true */ extensions)) return null
  const match = readdirSync(extensions)
    .filter((name) => name.startsWith('anthropic.claude-code-'))
    .sort()
    .reverse()
    .map((name) => join(extensions, name, 'resources/native-binary/claude'))
    .find((candidate) => existsSync(/* turbopackIgnore: true */ candidate))

  return match ?? null
}

export interface ClaudeRun {
  text: string
  costUsd: number
  durationMs: number
  turns: number
}

export async function runClaude(
  prompt: string,
  { model, effort }: { model: string; effort: string },
): Promise<ClaudeRun> {
  const binary = discoverBinary()
  if (!binary) {
    throw new ConfigError(
      'Local Claude Code was not found, so the agent analysis cannot run.',
      'Set CLAUDE_CLI_PATH to the claude binary. Looked in ~/.local/bin, ~/.claude/local, /usr/local/bin and the VS Code extension directory.',
    )
  }

  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    // Exactly the tools the analysis needs. A non-interactive session cannot prompt for approval,
    // and this app should never be able to drive anything beyond reading Sentry.
    '--allowedTools',
    agentConfig.allowedTools.join(','),
    // Without these the run inherits whatever the developer's own CLI is set to, so the
    // dashboard's cost silently depends on a personal setting outside the repo.
    '--model',
    model,
    '--effort',
    effort,
  ]

  const started = Date.now()
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []

  const child = spawn(/* turbopackIgnore: true */ binary, args, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => stdout.push(chunk))
  child.stderr.on('data', (chunk) => stderr.push(chunk))

  const timer = setTimeout(() => child.kill('SIGKILL'), agentConfig.timeoutMs)

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (exitCode) => resolve(exitCode))
  }).finally(() => clearTimeout(timer))

  const raw = Buffer.concat(stdout).toString('utf8')

  if (code !== 0 || raw.trim() === '') {
    const detail = Buffer.concat(stderr).toString('utf8').slice(0, 2000)
    if (code === null) {
      throw new SentryTimeoutError(
        `The agent did not finish within ${Math.round(agentConfig.timeoutMs / 1000)}s.`,
        `Killed after timeout. stderr: ${detail}`,
      )
    }
    throw new SentryUpstreamError(
      'The local Claude agent failed to produce an analysis.',
      `Exit code ${code}. stderr: ${detail}`,
    )
  }

  // The CLI can print a warning line before the JSON payload, so start at the first line that
  // opens an object — not the last brace, which lands inside the payload.
  const firstBrace = raw.indexOf('{')
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(firstBrace >= 0 ? raw.slice(firstBrace) : raw)
  } catch (cause) {
    throw new SentryUpstreamError(
      'The local Claude agent returned output this app could not read.',
      `First 500 characters: ${raw.slice(0, 500)}`,
      { cause },
    )
  }

  if (parsed.is_error) {
    throw new SentryUpstreamError(
      'The local Claude agent reported an error while analysing.',
      String(parsed.result ?? '').slice(0, 1000),
    )
  }

  return {
    text: String(parsed.result ?? ''),
    costUsd: Number(parsed.total_cost_usd ?? 0),
    durationMs: Date.now() - started,
    turns: Number(parsed.num_turns ?? 0),
  }
}
