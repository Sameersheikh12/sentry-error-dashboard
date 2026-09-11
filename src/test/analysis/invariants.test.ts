import { describe, expect, it } from 'vitest'
import { NOW, WINDOW_START, analyzeFull, snapshot, withHistory } from './fixtures'

const MS_PER_HOUR = 3_600_000

describe('invariants', () => {
  it('withholds a row claiming more users than events', () => {
    // The shape of the real bug: a figure read from the baseline period landing on a window row.
    const impossible = snapshot({
      id: 'bad',
      currentEvents: 0,
      baselineEvents: 5_000,
      userCount: 1_626,
      lastSeen: NOW - 66 * 24 * MS_PER_HOUR,
    })

    const { problems, violations } = analyzeFull([impossible])

    expect(problems).toHaveLength(0)
    expect(violations.map((violation) => violation.rule)).toContain('users<=events')
  })

  it('withholds a row that reports events in the window but was last seen before it', () => {
    const stale = snapshot({
      id: 'stale',
      currentEvents: 40,
      userCount: 10,
      lastSeen: WINDOW_START - 5 * MS_PER_HOUR,
    })

    const { problems, violations } = analyzeFull([stale])

    expect(problems).toHaveLength(0)
    expect(violations.map((violation) => violation.rule)).toContain('lastSeen-in-window')
  })

  it('keeps a silent issue whose last event predates the window', () => {
    // FADING legitimately reaches into the baseline; it just cannot claim window events or users.
    const faded = withHistory({
      baselinePerDay: 240,
      currentEvents: 0,
      overrides: { userCount: 0, lastSeen: WINDOW_START - 5 * MS_PER_HOUR },
    })

    const { problems, violations } = analyzeFull([faded])

    expect(violations).toHaveLength(0)
    expect(problems[0].state).toBe('FADING')
  })

  it('never lets a NEW problem have a firstSeen outside the window', () => {
    const mixed = analyzeFull([
      withHistory({
        baselinePerDay: 100,
        currentEvents: 100,
        overrides: { id: 'old', culprit: '/j/z', exceptionType: null, title: 'x', userCount: 9 },
      }),
      snapshot({
        id: 'young',
        culprit: '/j/z',
        exceptionType: null,
        title: 'x',
        currentEvents: 15,
        userCount: 4,
        firstSeen: NOW - 30 * 60_000,
      }),
    ])

    for (const problem of mixed.problems) {
      if (problem.state === 'NEW') {
        expect(problem.aggregate.firstSeen).toBeGreaterThanOrEqual(WINDOW_START)
      }
    }
    expect(mixed.violations).toHaveLength(0)
  })
})

describe('signal floors', () => {
  it('files a single-event, single-user problem below the threshold', () => {
    const trivial = snapshot({ id: 't', currentEvents: 1, userCount: 1, culprit: '/j/tiny' })
    const [problem] = analyzeFull([trivial]).problems

    expect(problem.belowThreshold).toBe(true)
  })

  it('applies the floor to every state, not only surges', () => {
    const barelyNew = snapshot({
      id: 'n',
      currentEvents: 2,
      userCount: 2,
      culprit: '/j/new',
      firstSeen: NOW - 10 * 60_000,
    })
    const [problem] = analyzeFull([barelyNew]).problems

    expect(problem.state).toBe('NEW')
    expect(problem.belowThreshold).toBe(true)
  })

  it('keeps a problem above both floors', () => {
    const real = snapshot({ id: 'r', currentEvents: 400, userCount: 90, culprit: '/j/real' })
    const [problem] = analyzeFull([real]).problems

    expect(problem.belowThreshold).toBe(false)
  })
})
