import { describe, expect, it } from 'vitest'
import { buildAnalysis, type AgentReply, type AgentSubject } from '@/lib/agent/analyze'

const subjects: AgentSubject[] = [
  { key: '/journey/capture-event', state: 'SURGING' as const, issueIds: ['INDUSIND-PWA-1H2'] },
  { key: '/journey/fetch-user-info', state: 'CHRONIC' as const, issueIds: ['INDUSIND-PWA-1H3'] },
]

const reply = (over: Partial<AgentReply> = {}): AgentReply => ({
  verdict: 'Journey lookups are failing',
  problems: [{ index: 1, rootCause: 'No Journey found', plainEnglish: 'The record is missing.' }],
  notes: [],
  ...over,
})

describe('buildAnalysis', () => {
  it('labels each explanation with the key this app sent, not one the agent supplies', () => {
    const analysis = buildAnalysis(reply(), subjects)
    expect(analysis.problems.map((p) => p.key)).toEqual(['/journey/capture-event'])
  })

  it('carries the state across, so the panel and the table label a problem the same way', () => {
    expect(buildAnalysis(reply(), subjects).problems[0].state).toBe('SURGING')
  })

  it('maps by position, so the second subject gets the second explanation', () => {
    const analysis = buildAnalysis(
      reply({
        problems: [
          { index: 2, rootCause: 'B', plainEnglish: 'second' },
          { index: 1, rootCause: 'A', plainEnglish: 'first' },
        ],
      }),
      subjects,
    )
    expect(analysis.problems).toEqual([
      {
        key: '/journey/fetch-user-info',
        state: 'CHRONIC',
        issueIds: ['INDUSIND-PWA-1H3'],
        rootCause: 'B',
        plainEnglish: 'second',
      },
      {
        key: '/journey/capture-event',
        state: 'SURGING',
        issueIds: ['INDUSIND-PWA-1H2'],
        rootCause: 'A',
        plainEnglish: 'first',
      },
    ])
  })

  it('drops an index outside the subject list rather than mislabelling it', () => {
    const analysis = buildAnalysis(
      reply({
        problems: [
          { index: 9, rootCause: 'x', plainEnglish: 'y' },
          { index: 1, rootCause: 'A', plainEnglish: 'a' },
        ],
      }),
      subjects,
    )
    expect(analysis.problems.map((p) => p.key)).toEqual(['/journey/capture-event'])
  })

  // A real run replied with this exact shape after being told not to.
  it('scrubs journey identifiers out of the root cause', () => {
    const analysis = buildAnalysis(
      reply({
        problems: [
          {
            index: 1,
            rootCause: 'No Journey found with User Journey ID usrj_2c6cee751a3b28e4',
            plainEnglish: 'Lookup failed.',
          },
        ],
      }),
      subjects,
    )
    expect(analysis.problems[0].rootCause).toBe('No Journey found with User Journey ID :id')
    expect(analysis.problems[0].rootCause).not.toContain('usrj_')
  })

  it('scrubs the verdict, the plain-English line and the notes too', () => {
    const analysis = buildAnalysis(
      reply({
        verdict: 'usrj_2c6cee751a3b28e4 is failing',
        problems: [
          { index: 1, rootCause: null, plainEnglish: 'Seen for usrj_d6d7ba6db869724a today.' },
        ],
        notes: ['Could not resolve usrj_c414f2b31f74b327'],
      }),
      subjects,
    )
    expect(JSON.stringify(analysis)).not.toContain('usrj_')
  })

  it('keeps a null root cause null, so "no upstream error" stays distinguishable', () => {
    const analysis = buildAnalysis(
      reply({ problems: [{ index: 1, rootCause: null, plainEnglish: 'Nothing attached.' }] }),
      subjects,
    )
    expect(analysis.problems[0].rootCause).toBeNull()
  })
})
