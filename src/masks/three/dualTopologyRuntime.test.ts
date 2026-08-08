import { describe, expect, it } from 'vitest'
import {
  DUAL_TOPOLOGY_ENTER_JAW,
  DUAL_TOPOLOGY_EXIT_JAW,
  DUAL_TOPOLOGY_OPEN_MORPH_START,
  resolveDualTopologyJaw,
} from './dualTopologyRuntime'

describe('resolveDualTopologyJaw v19 source-mouth contract', () => {
  it('keeps the exact original neutral mouth at rest', () => {
    expect(resolveDualTopologyJaw(0, false)).toEqual({
      openActive: false,
      morphJaw: 0,
    })
  })

  it('does not expose the artificial open-source neutral before a real opening', () => {
    const result = resolveDualTopologyJaw(DUAL_TOPOLOGY_ENTER_JAW - 0.001, false)
    expect(result.openActive).toBe(false)
    expect(result.morphJaw).toBe(0)
  })

  it('enters directly on a safe authored opening instead of open morph zero', () => {
    const result = resolveDualTopologyJaw(DUAL_TOPOLOGY_ENTER_JAW, false)
    expect(result.openActive).toBe(true)
    expect(result.morphJaw).toBeCloseTo(DUAL_TOPOLOGY_OPEN_MORPH_START, 8)
  })

  it('uses hysteresis without showing the open topology at morph zero', () => {
    const stillOpen = resolveDualTopologyJaw(DUAL_TOPOLOGY_EXIT_JAW + 0.01, true)
    expect(stillOpen.openActive).toBe(true)
    expect(stillOpen.morphJaw).toBeGreaterThanOrEqual(DUAL_TOPOLOGY_OPEN_MORPH_START)

    const closed = resolveDualTopologyJaw(DUAL_TOPOLOGY_EXIT_JAW, true)
    expect(closed).toEqual({ openActive: false, morphJaw: 0 })
  })

  it('reaches the exact authored Abierto_Dragon full-open endpoint at 100%', () => {
    const result = resolveDualTopologyJaw(1, true)
    expect(result.openActive).toBe(true)
    expect(result.morphJaw).toBeCloseTo(1, 8)
  })

  it('keeps a conversational opening below the full-open endpoint', () => {
    const result = resolveDualTopologyJaw(0.55, true)
    expect(result.openActive).toBe(true)
    expect(result.morphJaw).toBeGreaterThan(DUAL_TOPOLOGY_OPEN_MORPH_START)
    expect(result.morphJaw).toBeLessThan(0.75)
  })
})
