import { describe, expect, it } from 'vitest'
import {
  ALL_ENVIRONMENTS,
  activeFilterCount,
  clearedFilters,
  describeActiveFilters,
  parseFilters,
} from '@/lib/dashboard/filters'

const filtersFrom = (query: string) =>
  parseFilters(Object.fromEntries(new URLSearchParams(query)))

describe('describeActiveFilters', () => {
  it('shows nothing when nothing is applied', () => {
    expect(describeActiveFilters(filtersFrom('window=24h'))).toEqual([])
  })

  it('gives every applied value its own removable chip', () => {
    const filters = filtersFrom('env=prod&state=new,surging&level=error&release=1.2.3&q=journey')
    const chips = describeActiveFilters(filters)
    expect(chips.map((chip) => chip.value)).toEqual([
      'prod',
      'new',
      'surging',
      'error',
      '1.2.3',
      'journey',
    ])
  })

  /** A filter that counts but has no chip is one the reader can see but cannot remove. */
  it('never disagrees with the count shown next to Clear all', () => {
    for (const query of [
      'window=24h',
      'env=prod',
      'env=all&grouping=none',
      'state=new,surging,chronic&level=error,fatal',
      'q=fetch&release=2.0.0&env=prod&grouping=none',
    ]) {
      const filters = filtersFrom(query)
      const chips = describeActiveFilters(filters)
      const count = activeFilterCount(filters)
      // States and levels count once each but get a chip per value, so compare group counts.
      const groups = new Set(chips.map((chip) => chip.id.split(':')[0]))
      expect(groups.size).toBe(count)
    }
  })

  it('removing one chip leaves the others alone', () => {
    const filters = filtersFrom('state=new,surging&level=error')
    const surging = describeActiveFilters(filters).find((chip) => chip.value === 'surging')
    expect(surging).toBeDefined()
    const after = { ...filters, ...surging!.clear }
    expect(after.states).toEqual(['NEW'])
    expect(after.levels).toEqual(['error'])
  })

  it('distinguishes a deliberate "all environments" from no environment filter', () => {
    const all = describeActiveFilters(filtersFrom(`env=${ALL_ENVIRONMENTS}`))
    expect(all).toHaveLength(1)
    expect(all[0].value).toBe('all environments')
    expect(describeActiveFilters(filtersFrom('window=24h'))).toEqual([])
  })

  it('clearing every chip one at a time ends where Clear all ends', () => {
    let filters = filtersFrom('env=prod&state=new&level=error&release=1.0&q=x&grouping=none')
    for (let guard = 0; guard < 20; guard += 1) {
      const [next] = describeActiveFilters(filters)
      if (!next) break
      filters = { ...filters, ...next.clear }
    }
    expect(describeActiveFilters(filters)).toEqual([])
    expect(filters).toEqual(clearedFilters(filters))
  })
})
