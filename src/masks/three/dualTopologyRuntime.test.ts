import { describe, expect, it } from 'vitest'
import {
  DUAL_TOPOLOGY_ENTER_JAW,
  DUAL_TOPOLOGY_EXIT_JAW,
  RIGID_JAW_HINGE_Y,
  RIGID_JAW_HINGE_Z,
  RIGID_JAW_MAX_ANGLE_RAD,
  resolveDualTopologyJaw,
  rigidJawPivotOffset,
} from './dualTopologyRuntime'

describe('resolveDualTopologyJaw', () => {
  it('keeps the exact neutral jaw at rest', () => {
    expect(resolveDualTopologyJaw(0, false)).toEqual({
      openActive: false,
      morphJaw: 0,
      jawAngleRad: 0,
    })
  })

  it('rotates the neutral jaw continuously before the cavity is revealed', () => {
    const jaw = DUAL_TOPOLOGY_ENTER_JAW - 0.001
    const result = resolveDualTopologyJaw(jaw, false)
    expect(result.openActive).toBe(false)
    expect(result.morphJaw).toBeCloseTo(jaw, 6)
    expect(result.jawAngleRad).toBeCloseTo(jaw * RIGID_JAW_MAX_ANGLE_RAD, 6)
  })

  it('reveals the oral cavity only after a real opening', () => {
    const result = resolveDualTopologyJaw(DUAL_TOPOLOGY_ENTER_JAW, false)
    expect(result.openActive).toBe(true)
    expect(result.morphJaw).toBeCloseTo(DUAL_TOPOLOGY_ENTER_JAW, 6)
  })

  it('uses hysteresis only for cavity visibility', () => {
    const stillOpen = resolveDualTopologyJaw(DUAL_TOPOLOGY_EXIT_JAW + 0.01, true)
    expect(stillOpen.openActive).toBe(true)

    const closed = resolveDualTopologyJaw(DUAL_TOPOLOGY_EXIT_JAW, true)
    expect(closed.openActive).toBe(false)
    expect(closed.morphJaw).toBeCloseTo(DUAL_TOPOLOGY_EXIT_JAW, 6)
  })

  it('uses the full rigid-jaw angle at 100%', () => {
    const result = resolveDualTopologyJaw(1, true)
    expect(result.openActive).toBe(true)
    expect(result.morphJaw).toBe(1)
    expect(result.jawAngleRad).toBeCloseTo(RIGID_JAW_MAX_ANGLE_RAD, 8)
  })
})

describe('rigidJawPivotOffset', () => {
  it('keeps the hinge point stationary', () => {
    const angle = RIGID_JAW_MAX_ANGLE_RAD
    const offset = rigidJawPivotOffset(angle)
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)

    const rotatedY = RIGID_JAW_HINGE_Y * cosine - RIGID_JAW_HINGE_Z * sine + offset.y
    const rotatedZ = RIGID_JAW_HINGE_Y * sine + RIGID_JAW_HINGE_Z * cosine + offset.z

    expect(rotatedY).toBeCloseTo(RIGID_JAW_HINGE_Y, 8)
    expect(rotatedZ).toBeCloseTo(RIGID_JAW_HINGE_Z, 8)
  })
})
