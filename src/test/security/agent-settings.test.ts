import { describe, expect, it } from 'vitest'
import { agentConfig, resolveEffort, resolveModel } from '@/lib/config/agent.config'

/**
 * These values become arguments to a spawned process. `spawn` takes an argument array and no
 * shell, so there is no injection to worry about — but an unrecognised model still means a run
 * that fails late, or one that silently costs far more than the reader chose.
 */
describe('agent settings resolution', () => {
  it('accepts every model the picker can offer', () => {
    for (const model of agentConfig.selectableModels) {
      expect(resolveModel(model)).toBe(model)
    }
  })

  it('accepts every effort the picker can offer', () => {
    for (const effort of agentConfig.selectableEfforts) {
      expect(resolveEffort(effort)).toBe(effort)
    }
  })

  it('falls back to the configured default for anything not on the list', () => {
    for (const rejected of ['gpt-4', 'opus --dangerously-skip-permissions', '', '../../claude']) {
      expect(resolveModel(rejected)).toBe(agentConfig.model)
      expect(resolveEffort(rejected)).toBe(agentConfig.effort)
    }
  })

  it('falls back when the parameter is absent', () => {
    expect(resolveModel(null)).toBe(agentConfig.model)
    expect(resolveEffort(undefined)).toBe(agentConfig.effort)
  })

  it('has defaults that are themselves selectable, so the picker can always show the current value', () => {
    expect(agentConfig.selectableModels).toContain(agentConfig.model)
    expect(agentConfig.selectableEfforts).toContain(agentConfig.effort)
  })
})
