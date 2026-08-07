import { describe, expect, it } from 'vitest'
import {
  DUAL_TOPOLOGY_ENTER_JAW,
  DUAL_TOPOLOGY_EXIT_JAW,
  DUAL_TOPOLOGY_OPEN_MORPH_START,
  resolveDualTopologyJaw,
} from './dualTopologyRuntime'

describe('resolveDualTopologyJaw', () => {
  it('keeps the exact original neutral active at rest', () => {
    expect(resolveDualTopologyJaw(0, false)).toEqual({ openActive: false, morphJaw: 0 })
    expect(resolveDualTopologyJaw(DUAL_TOPOLOGY_ENTER_JAW - 0.001, false)).toEqual({
      openActive: false,
      morphJaw: 0,
    })
  })

  it('switches to the original open topology only after a real opening', () => {
    const result = resolveDualTopologyJaw(DUAL_TOPOLOGY_ENTER_JAW, false)
    expect(result.openActive).toBe(true)
    expect(result.morphJaw).toBeCloseTo(DUAL_TOPOLOGY_OPEN_MORPH_START, 6)
  })

  it('uses hysteresis so tracking noise cannot chatter between topologies', () => {
    const stillOpen = resolveDualTopologyJaw(DUAL_TOPOLOGY_EXIT_JAW + 0.01, true)
    expect(stillOpen.openActive).toBe(true)

    const closed = resolveDualTopologyJaw(DUAL_TOPOLOGY_EXIT_JAW, true)
    expect(closed).toEqual({ openActive: false, morphJaw: 0 })
  })

  it('preserves the exact full-open endpoint', () => {
    const result = resolveDualTopologyJaw(1, true)
    expect(result.openActive).toBe(true)
    expect(result.morphJaw).toBe(1)
  })
})
