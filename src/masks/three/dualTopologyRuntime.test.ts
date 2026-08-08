import { describe, expect, it } from 'vitest'
import {
  DUAL_TOPOLOGY_ENTER_JAW,
  DUAL_TOPOLOGY_EXIT_JAW,
  resolveDualTopologyJaw,
} from './dualTopologyRuntime'

describe('resolveDualTopologyJaw', () => {
  it('keeps the exact neutral jaw at rest', () => {
    expect(resolveDualTopologyJaw(0, false)).toEqual({ openActive: false, morphJaw: 0 })
  })

  it('deforms the neutral outer jaw continuously before the cavity is revealed', () => {
    const jaw = DUAL_TOPOLOGY_ENTER_JAW - 0.001
    expect(resolveDualTopologyJaw(jaw, false)).toEqual({
      openActive: false,
      morphJaw: jaw,
    })
  })

  it('reveals the oral cavity after a real opening without changing morph amplitude', () => {
    const result = resolveDualTopologyJaw(DUAL_TOPOLOGY_ENTER_JAW, false)
    expect(result.openActive).toBe(true)
    expect(result.morphJaw).toBeCloseTo(DUAL_TOPOLOGY_ENTER_JAW, 6)
  })

  it('uses hysteresis only for cavity visibility', () => {
    const stillOpen = resolveDualTopologyJaw(DUAL_TOPOLOGY_EXIT_JAW + 0.01, true)
    expect(stillOpen.openActive).toBe(true)
    expect(stillOpen.morphJaw).toBeCloseTo(DUAL_TOPOLOGY_EXIT_JAW + 0.01, 6)

    const closed = resolveDualTopologyJaw(DUAL_TOPOLOGY_EXIT_JAW, true)
    expect(closed).toEqual({
      openActive: false,
      morphJaw: DUAL_TOPOLOGY_EXIT_JAW,
    })
  })

  it('preserves the exact full-open morph endpoint', () => {
    const result = resolveDualTopologyJaw(1, true)
    expect(result).toEqual({ openActive: true, morphJaw: 1 })
  })
})
