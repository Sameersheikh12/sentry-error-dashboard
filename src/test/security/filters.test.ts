import { describe, expect, it } from 'vitest'
import {
  ALL_ENVIRONMENTS,
  CUSTOM_WINDOW,
  activeFilterCount,
  clearedFilters,
  filtersToQueryString,
  parseFilters,
} from '@/lib/dashboard/filters'

const parseQuery = (qs: string) =>
  parseFilters(Object.fromEntries(new URLSearchParams(qs)))

describe('URL round-trip', () => {
  it('reproduces a shared view exactly', () => {
    // The point of putting every filter in the URL: a link pasted into an incident channel
    // must render the same screen for the next person.
    const qs = 'project=indusind-pwa&env=prod&window=7d&state=new,surging&level=error&sort=users&q=journey&grouping=none&chart=off'
    const round = filtersToQueryString(parseQuery(qs))
    const back = parseQuery(round)

    expect(back).toEqual(parseQuery(qs))
    expect(back.projectSlug).toBe('indusind-pwa')
    expect(back.states).toEqual(['NEW', 'SURGING'])
    expect(back.levels).toEqual(['error'])
    expect(back.sort).toBe('users')
    expect(back.search).toBe('journey')
    expect(back.grouping).toBe('none')
    expect(back.showChart).toBe(false)
  })

  it('round-trips an absolute window', () => {
    const qs = 'project=p&start=2026-08-01T00:00:00.000Z&end=2026-08-08T00:00:00.000Z'
    const parsed = parseQuery(qs)
    expect(parsed.window).toBe(CUSTOM_WINDOW)

    const back = parseQuery(filtersToQueryString(parsed))
    expect(back.start?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(back.end?.toISOString()).toBe('2026-08-08T00:00:00.000Z')
  })

  it('ignores a reversed or malformed range instead of querying it', () => {
    expect(parseQuery('start=2026-08-08T00:00:00Z&end=2026-08-01T00:00:00Z').window).not.toBe(
      CUSTOM_WINDOW,
    )
    expect(parseQuery('start=nonsense&end=also-nonsense').window).not.toBe(CUSTOM_WINDOW)
  })

  it('falls back to defaults for unknown values rather than failing', () => {
    const parsed = parseQuery('window=99y&sort=bogus&state=banana&level=verbose')
    expect(parsed.window).toBe('24h')
    expect(parsed.sort).toBe('score')
    expect(parsed.states).toEqual([])
    expect(parsed.levels).toEqual([])
  })
})

describe('applied-filter accounting', () => {
  it('does not count the project or window as filters', () => {
    expect(activeFilterCount(parseQuery('project=p&window=7d'))).toBe(0)
  })

  it('counts each narrowing the user actually applied', () => {
    expect(activeFilterCount(parseQuery('project=p&state=new&level=error&q=x'))).toBe(3)
  })

  it('treats an unspecified environment as no filter, but an explicit one as a filter', () => {
    // Without this distinction "Clear all" resets env to undefined, the default reapplies,
    // and the button appears to do nothing.
    expect(activeFilterCount(parseQuery('project=p'))).toBe(0)
    expect(activeFilterCount(parseQuery('project=p&env=prod'))).toBe(1)
    expect(activeFilterCount(parseQuery(`project=p&env=${ALL_ENVIRONMENTS}`))).toBe(1)
  })

  it('clears everything it claims to, and nothing it should not', () => {
    const cleared = clearedFilters(parseQuery('project=p&window=7d&state=new&env=prod&q=x&grouping=none'))

    expect(activeFilterCount(cleared)).toBe(0)
    expect(cleared.projectSlug).toBe('p')
    expect(cleared.window).toBe('7d')
  })
})
