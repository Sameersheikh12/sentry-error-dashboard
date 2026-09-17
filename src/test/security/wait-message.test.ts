import { describe, expect, it } from 'vitest'
import { waitCopy, type WaitKind } from '@/components/dashboard/wait-message'

const KINDS: WaitKind[] = ['sweep', 'add', 'ask']

describe('waitCopy', () => {
  it('omits the count for the first few seconds, when it would be noise', () => {
    for (const kind of KINDS) {
      expect(waitCopy(kind, 0, 180).text).not.toMatch(/\d+s/)
      expect(waitCopy(kind, 3, 180).text).not.toMatch(/\d+s/)
    }
  })

  it('shows a real elapsed count once there is one worth showing', () => {
    expect(waitCopy('ask', 12, 180).text).toContain('12s')
    expect(waitCopy('sweep', 29, 180).text).toContain('29s')
  })

  it('changes wording at 30s so an unchanging line does not read as a hang', () => {
    for (const kind of KINDS) {
      expect(waitCopy(kind, 12, 180).text).not.toBe(waitCopy(kind, 40, 180).text)
    }
  })

  it('says a follow-up needs several lookups, which is why it is slow', () => {
    expect(waitCopy('ask', 40, 180).text).toContain('a few lookups')
  })

  it('marks the run slow past 75s and names the timeout, so waiting is a decision', () => {
    const copy = waitCopy('ask', 80, 180)
    expect(copy.slow).toBe(true)
    expect(copy.text).toContain('180s')
    expect(waitCopy('ask', 74, 180).slow).toBe(false)
  })

  it('never reports a negative or fractional second count', () => {
    expect(waitCopy('ask', -5, 180).text).not.toContain('-')
    expect(waitCopy('ask', 12.7, 180).text).toContain('12s')
  })
})
