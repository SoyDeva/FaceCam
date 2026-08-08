import { describe, expect, it } from 'vitest'
import {
  DUAL_TOPOLOGY_ENTER_JAW,
  DUAL_TOPOLOGY_EXIT_JAW,
  DUAL_TOPOLOGY_OPEN_MORPH_START,
  resolveDualTopologyJaw,
} from './dualTopologyRuntime'

describe('resolveDualTopologyJaw v25 switchable-upper-seam contract', () => {
  it('keeps the exact v20-derived closed geometry active at rest', () => {
    expect(resolveDualTopologyJaw(0, false)).toEqual({
      openActive: false,
      morphJaw: 0,
    })
    expect(resolveDualTopologyJaw(DUAL_TOPOLOGY_ENTER_JAW - 0.001, false)).toEqual({
      openActive: false,
      morphJaw: 0,
    })
  })

  it('switches to the authored open source only after a real jaw opening', () => {
    const result = resolveDualTopologyJaw(DUAL_TOPOLOGY_ENTER_JAW, false)
    expect(result.openActive).toBe(true)
    expect(result.morphJaw).toBeCloseTo(DUAL_TOPOLOGY_OPEN_MORPH_START, 8)
  })

  it('uses hysteresis so the upper seam cannot chatter on tracking noise', () => {
    const stillOpen = resolveDualTopologyJaw(DUAL_TOPOLOGY_EXIT_JAW + 0.01, true)
    expect(stillOpen.openActive).toBe(true)
    expect(stillOpen.morphJaw).toBeGreaterThanOrEqual(DUAL_TOPOLOGY_OPEN_MORPH_START)

    const closed = resolveDualTopologyJaw(DUAL_TOPOLOGY_EXIT_JAW, true)
    expect(closed).toEqual({ openActive: false, morphJaw: 0 })
  })

  it('preserves the exact authored Abierto_Dragon full-open endpoint', () => {
    const result = resolveDualTopologyJaw(1, true)
    expect(result).toEqual({ openActive: true, morphJaw: 1 })
  })

  it('keeps conversational openings below the full-open endpoint', () => {
    const result = resolveDualTopologyJaw(0.55, true)
    expect(result.openActive).toBe(true)
    expect(result.morphJaw).toBeGreaterThan(DUAL_TOPOLOGY_OPEN_MORPH_START)
    expect(result.morphJaw).toBeLessThan(0.75)
  })

  it('clamps malformed jaw values without changing the topology contract', () => {
    expect(resolveDualTopologyJaw(-1, false)).toEqual({ openActive: false, morphJaw: 0 })
    expect(resolveDualTopologyJaw(2, true)).toEqual({ openActive: true, morphJaw: 1 })
  })
})
