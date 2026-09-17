import { beforeEach, describe, expect, it, vi } from 'vitest'

const runClaude = vi.fn()
vi.mock('@/lib/agent/claude-cli', () => ({ runClaude: (...args: unknown[]) => runClaude(...args) }))

// Imported after the mock so analyze.ts picks up the mocked module.
const { analyseWithAgent, resetAnalysisCache } = await import('@/lib/agent/analyze')
const { resetSpend } = await import('@/lib/agent/budget')
import type { AgentRequest } from '@/lib/agent/analyze'

const baseRequest = (subjects: AgentRequest['subjects'], mode: 'sweep' | 'add' = 'sweep'): AgentRequest => ({
  organization: 'hyperface',
  projectSlug: 'indusind-pwa',
  window: '24h',
  environment: 'prod',
  model: 'haiku',
  effort: 'low',
  mode,
  subjects,
})

const subject = (key: string) => ({ key, state: 'CHRONIC' as const, issueIds: [`ISSUE-${key}`] })

/** A reply naming the problems by the position they were sent in, matching the real prompt contract. */
function replyFor(keys: string[], verdict = 'a verdict') {
  return {
    text: JSON.stringify({
      verdict,
      problems: keys.map((key, i) => ({
        index: i + 1,
        rootCause: `cause for ${key}`,
        plainEnglish: `explanation for ${key}`,
      })),
      notes: [],
    }),
    costUsd: 0.05,
    durationMs: 1000,
    turns: 3,
  }
}

describe('analyseWithAgent (per-problem cache)', () => {
  beforeEach(() => {
    resetAnalysisCache()
    resetSpend()
    runClaude.mockReset()
  })

  it('reads every subject on a fresh sweep and caches each one', async () => {
    runClaude.mockResolvedValueOnce(replyFor(['a', 'b', 'c']))
    const result = await analyseWithAgent(baseRequest([subject('a'), subject('b'), subject('c')]), 0)

    expect(runClaude).toHaveBeenCalledTimes(1)
    expect(result.analysedNow).toBe(3)
    expect(result.fromCache).toBe(0)
    expect(result.analysis.problems.map((p) => p.key)).toEqual(['a', 'b', 'c'])
  })

  it('serves an identical request entirely from cache, at zero cost', async () => {
    runClaude.mockResolvedValueOnce(replyFor(['a', 'b', 'c']))
    await analyseWithAgent(baseRequest([subject('a'), subject('b'), subject('c')]), 0)

    const again = await analyseWithAgent(baseRequest([subject('a'), subject('b'), subject('c')]), 1000)
    expect(runClaude).toHaveBeenCalledTimes(1)
    expect(again.costUsd).toBe(0)
    expect(again.cached).toBe(true)
    expect(again.analysis.problems.map((p) => p.key)).toEqual(['a', 'b', 'c'])
  })

  // This is the property the whole per-problem cache exists for.
  it('adding a fourth subject reads only the new one, not the three already done', async () => {
    runClaude.mockResolvedValueOnce(replyFor(['a', 'b', 'c']))
    await analyseWithAgent(baseRequest([subject('a'), subject('b'), subject('c')]), 0)

    runClaude.mockResolvedValueOnce(replyFor(['d']))
    const result = await analyseWithAgent(
      baseRequest([subject('a'), subject('b'), subject('c'), subject('d')], 'add'),
      1000,
    )

    expect(runClaude).toHaveBeenCalledTimes(2)
    // Only the miss was sent to the agent — not the three already cached.
    const sentPrompt = runClaude.mock.calls[1][0] as string
    expect(sentPrompt).toContain('d')
    expect(sentPrompt).not.toMatch(/\ba\b.*issues:|issues:.*\ba\b/)
    expect(result.analysedNow).toBe(1)
    expect(result.fromCache).toBe(3)
    expect(result.analysis.problems.map((p) => p.key)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('re-adding something already read costs nothing and reads nothing', async () => {
    runClaude.mockResolvedValueOnce(replyFor(['a']))
    await analyseWithAgent(baseRequest([subject('a')]), 0)

    const again = await analyseWithAgent(baseRequest([subject('a')], 'add'), 500)
    expect(runClaude).toHaveBeenCalledTimes(1)
    expect(again.costUsd).toBe(0)
    expect(again.analysedNow).toBe(0)
  })

  it('keeps the sweep verdict on an add-run rather than replacing it', async () => {
    runClaude.mockResolvedValueOnce(replyFor(['a', 'b'], 'the real verdict'))
    await analyseWithAgent(baseRequest([subject('a'), subject('b')]), 0)

    runClaude.mockResolvedValueOnce(replyFor(['c'], 'a verdict an add-run must not surface'))
    const result = await analyseWithAgent(
      baseRequest([subject('a'), subject('b'), subject('c')], 'add'),
      500,
    )
    expect(result.analysis.verdict).toBe('the real verdict')
  })

  /**
   * The bug this guards against: the verdict cache entry used to keep its ORIGINAL expiry on every
   * add-run, while the findings it was paired with got a fresh one. Long enough after the sweep,
   * the verdict could go stale while an added subject's own finding was still live — and if that
   * was the only thing being asked about, the response would silently lose its verdict text (or,
   * without the defensive fallback below, hit the agent with an empty problem list). The fix
   * renews the verdict's expiry on every real write, add or sweep.
   *
   * `now` is milliseconds, matching `Date.now()` — `expiresAt` below is computed as
   * `now + cacheSeconds * 1000`, so the offsets here have to be on that same scale or they never
   * approach a real expiry boundary. An earlier version of this test used second-sized offsets
   * against millisecond math and passed against the very bug it was meant to catch.
   */
  it('an add-run renews the verdict past what the original sweep alone would have granted', async () => {
    const cacheMs = 900 * 1000 // matches the configured cacheSeconds default, converted to ms
    runClaude.mockResolvedValueOnce(replyFor(['a'], 'sweep verdict'))
    await analyseWithAgent(baseRequest([subject('a')]), 0)

    // Just before the sweep's own entry would expire, add a second subject.
    runClaude.mockResolvedValueOnce(replyFor(['b'], 'must not be used'))
    await analyseWithAgent(baseRequest([subject('a'), subject('b')], 'add'), cacheMs - 10_000)

    // Past the ORIGINAL sweep's expiry, but within the add-run's renewed one, ask only about `b`.
    const result = await analyseWithAgent(baseRequest([subject('b')], 'add'), cacheMs + 5_000)

    expect(runClaude).toHaveBeenCalledTimes(2) // no third call: nothing new to read
    expect(result.costUsd).toBe(0)
    expect(result.analysis.verdict).toBe('sweep verdict')
  })

  it('a genuine miss after every TTL lapses still reads normally, not from the empty-request path', async () => {
    runClaude.mockResolvedValueOnce(replyFor(['a']))
    await analyseWithAgent(baseRequest([subject('a')]), 0)

    // Long past every TTL: `a`'s finding has expired too, so this is an ordinary re-read.
    runClaude.mockResolvedValueOnce(replyFor(['a'], 'refreshed verdict'))
    const result = await analyseWithAgent(baseRequest([subject('a')]), 10_000_000)

    expect(runClaude).toHaveBeenCalledTimes(2)
    expect(result.analysedNow).toBe(1)
    expect(result.analysis.verdict).toBe('refreshed verdict')
  })
})

describe('analyseWithAgent (concurrent requests)', () => {
  beforeEach(() => {
    resetAnalysisCache()
    resetSpend()
    runClaude.mockReset()
  })

  /**
   * Nothing here relied on a lock existing before this test — it is exercising a real gap: the
   * cache above only checks state at the moment a call is made, so two overlapping calls for the
   * same view used to both find the same subject missing and both pay to read it. A double-click
   * on Re-analyse, or two tabs open on the same URL, do exactly this.
   */
  it('coalesces two overlapping requests for the same view into one agent call', async () => {
    let releaseAgent: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      releaseAgent = resolve
    })
    runClaude.mockImplementation(async () => {
      await gate
      return replyFor(['a'])
    })

    const first = analyseWithAgent(baseRequest([subject('a')]), 0)
    // Give the first call a chance to register itself as in-flight before the second starts.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const second = analyseWithAgent(baseRequest([subject('a')]), 0)

    releaseAgent!()
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(runClaude).toHaveBeenCalledTimes(1)
    expect(firstResult.analysis.problems.map((p) => p.key)).toEqual(['a'])
    expect(secondResult.analysis.problems.map((p) => p.key)).toEqual(['a'])
    // The waiting call paid nothing — it read the first call's result out of the cache.
    expect(secondResult.costUsd).toBe(0)
  })

  it('a failed run does not block the next caller from trying again', async () => {
    runClaude.mockRejectedValueOnce(new Error('agent crashed'))
    await expect(analyseWithAgent(baseRequest([subject('a')]), 0)).rejects.toThrow('agent crashed')

    runClaude.mockResolvedValueOnce(replyFor(['a']))
    const result = await analyseWithAgent(baseRequest([subject('a')]), 100)
    expect(result.analysis.problems.map((p) => p.key)).toEqual(['a'])
  })
})
