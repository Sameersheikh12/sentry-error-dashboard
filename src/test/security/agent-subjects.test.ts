import { describe, expect, it } from 'vitest'
import type { AgentSubject } from '@/lib/agent/analyze'
import { parseRequestedKeys, resolveSubjects } from '@/lib/agent/subjects'

const ranked: AgentSubject[] = ['a', 'b', 'c', 'd', 'e'].map((key) => ({
  key,
  state: 'CHRONIC',
  issueIds: [`ISSUE-${key.toUpperCase()}`],
}))

const keys = (subjects: AgentSubject[]) => subjects.map((subject) => subject.key)

describe('resolveSubjects', () => {
  it('sweeps the top of the ranking when nothing extra is asked for', () => {
    const { subjects, mode } = resolveSubjects(ranked, [], 3)
    expect(keys(subjects)).toEqual(['a', 'b', 'c'])
    expect(mode).toBe('sweep')
  })

  it('appends a named problem from further down, keeping the swept ones', () => {
    const { subjects, mode } = resolveSubjects(ranked, ['e'], 3)
    expect(keys(subjects)).toEqual(['a', 'b', 'c', 'e'])
    expect(mode).toBe('add')
  })

  /** Otherwise "add the one you already read" would be a second paid read of the same problem. */
  it('ignores a request for something the sweep already covers', () => {
    const { subjects, mode } = resolveSubjects(ranked, ['b'], 3)
    expect(keys(subjects)).toEqual(['a', 'b', 'c'])
    expect(mode).toBe('sweep')
  })

  it('ignores a repeated request rather than adding it twice', () => {
    const { subjects } = resolveSubjects(ranked, ['d', 'd', 'd'], 3)
    expect(keys(subjects)).toEqual(['a', 'b', 'c', 'd'])
  })

  /** The key arrives off the query string, so it must be a name the ranking actually holds. */
  it('drops a key that is not in the ranking', () => {
    const { subjects, mode } = resolveSubjects(ranked, ['../../etc/passwd', 'nope'], 3)
    expect(keys(subjects)).toEqual(['a', 'b', 'c'])
    expect(mode).toBe('sweep')
  })

  it('carries the issue ids of the added problem, not of some other one', () => {
    const { subjects } = resolveSubjects(ranked, ['e'], 3)
    expect(subjects.at(-1)).toEqual({ key: 'e', state: 'CHRONIC', issueIds: ['ISSUE-E'] })
  })

  it('handles a ranking shorter than the sweep size', () => {
    const { subjects } = resolveSubjects(ranked.slice(0, 2), ['d'], 3)
    expect(keys(subjects)).toEqual(['a', 'b'])
  })
})

describe('parseRequestedKeys', () => {
  it('splits, trims and drops empties', () => {
    expect(parseRequestedKeys(' a , b ,, c ')).toEqual(['a', 'b', 'c'])
  })

  it('treats a missing parameter as nothing requested', () => {
    expect(parseRequestedKeys(null)).toEqual([])
    expect(parseRequestedKeys('')).toEqual([])
  })
})
