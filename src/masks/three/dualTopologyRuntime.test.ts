import { describe, expect, it } from 'vitest'
import {
  DUAL_TOPOLOGY_ENTER_JAW,
  DUAL_TOPOLOGY_EXIT_JAW,
  ORAL_CAVITY_MAX_RECESS_Z,
  ORAL_CAVITY_MIN_SCALE_X,
  ORAL_CAVITY_MORPH_MAX,
  RIGID_JAW_HINGE_Y,
  RIGID_JAW_HINGE_Z,
  RIGID_JAW_MAX_ANGLE_RAD,
  resolveDualTopologyJaw,
  resolveOralCavityPresentation,
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
    expect(result.morphJaw).toBeGreaterThan(0)
    expect(result.morphJaw).toBeLessThan(jaw)
    expect(result.jawAngleRad).toBeCloseTo(jaw * RIGID_JAW_MAX_ANGLE_RAD, 6)
  })

  it('reveals the oral cavity only after a real opening', () => {
    const result = resolveDualTopologyJaw(DUAL_TOPOLOGY_ENTER_JAW, false)
    expect(result.openActive).toBe(true)
    expect(result.morphJaw).toBeGreaterThan(0)
    expect(result.morphJaw).toBeLessThan(DUAL_TOPOLOGY_ENTER_JAW)
  })

  it('uses hysteresis only for cavity visibility', () => {
    const stillOpen = resolveDualTopologyJaw(DUAL_TOPOLOGY_EXIT_JAW + 0.01, true)
    expect(stillOpen.openActive).toBe(true)

    const closed = resolveDualTopologyJaw(DUAL_TOPOLOGY_EXIT_JAW, true)
    expect(closed.openActive).toBe(false)
    expect(closed.morphJaw).toBeGreaterThan(0)
  })

  it('uses the full rigid-jaw angle while clamping only the cavity morph', () => {
    const result = resolveDualTopologyJaw(1, true)
    expect(result.openActive).toBe(true)
    expect(result.morphJaw).toBe(ORAL_CAVITY_MORPH_MAX)
    expect(result.jawAngleRad).toBeCloseTo(RIGID_JAW_MAX_ANGLE_RAD, 8)
  })
})

describe('resolveOralCavityPresentation', () => {
  it('leaves the cavity transform neutral at rest', () => {
    expect(resolveOralCavityPresentation(0)).toEqual({
      morphJaw: 0,
      scaleX: 1,
      recessZ: 0,
    })
  })

  it('keeps a conversational opening narrower and deeper than the exterior jaw', () => {
    const cavity = resolveOralCavityPresentation(0.52)
    expect(cavity.morphJaw).toBeLessThan(0.52)
    expect(cavity.scaleX).toBeLessThan(0.94)
    expect(cavity.scaleX).toBeGreaterThan(ORAL_CAVITY_MIN_SCALE_X)
    expect(cavity.recessZ).toBeGreaterThan(0.012)
    expect(cavity.recessZ).toBeLessThan(ORAL_CAVITY_MAX_RECESS_Z)
  })

  it('never exposes the cavity beyond its safe full-open presentation', () => {
    const cavity = resolveOralCavityPresentation(1)
    expect(cavity.morphJaw).toBe(ORAL_CAVITY_MORPH_MAX)
    expect(cavity.scaleX).toBeCloseTo(ORAL_CAVITY_MIN_SCALE_X, 8)
    expect(cavity.recessZ).toBeCloseTo(ORAL_CAVITY_MAX_RECESS_Z, 8)
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
