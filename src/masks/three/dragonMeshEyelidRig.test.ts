import { describe, expect, it } from 'vitest'
import {
  resolveDragonEyelidVertexWeight,
  resolveDragonMeshBlink,
} from './dragonMeshEyelidRig'

describe('resolveDragonMeshBlink', () => {
  it('keeps weak eyelid noise fully open', () => {
    expect(resolveDragonMeshBlink(0.08)).toBe(0)
  })

  it('turns a natural blink into a clear closure', () => {
    expect(resolveDragonMeshBlink(0.35)).toBeGreaterThan(0.68)
  })

  it('reaches full closure before the signal saturates', () => {
    expect(resolveDragonMeshBlink(0.52)).toBe(1)
    expect(resolveDragonMeshBlink(1)).toBe(1)
  })
})

describe('resolveDragonEyelidVertexWeight', () => {
  const leftEye = {
    x: -0.17,
    y: 0.05,
    radiusX: 0.145,
    radiusY: 0.105,
    side: 'left' as const,
  }

  it('targets the dragon eye region strongly', () => {
    expect(
      resolveDragonEyelidVertexWeight(-0.17, 0.05, 0.4, leftEye, -0.05, 0.5, 0.028),
    ).toBeGreaterThan(0.8)
  })

  it('does not deform the central snout', () => {
    expect(
      resolveDragonEyelidVertexWeight(0, 0.05, 0.4, leftEye, -0.05, 0.5, 0.028),
    ).toBe(0)
  })

  it('does not deform the rear of the head', () => {
    expect(
      resolveDragonEyelidVertexWeight(-0.17, 0.05, -0.2, leftEye, -0.05, 0.5, 0.028),
    ).toBe(0)
  })
})
