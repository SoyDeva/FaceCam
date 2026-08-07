import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three'
import { describe, expect, it } from 'vitest'
import {
  applyDragonMeshEyelidRig,
  createDragonMeshEyelidRig,
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

describe('v7 real-mesh eyelid isolation', () => {
  it('moves only the requested visible eye region and preserves jaw state', () => {
    const bounds = new Box3(
      new Vector3(-1, -1, -1),
      new Vector3(1, 1, 1),
    )
    const size = new Vector3(2, 2, 2)
    const center = new Vector3(0, 0, 0)
    const modelEyeY = bounds.min.y + size.y * 0.55
    const v7EyeY = bounds.min.y + size.y * 0.46 - modelEyeY

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([
      -0.34, v7EyeY, 0.9, // visible left eye region
       0.34, v7EyeY, 0.9, // visible right eye region
       0.00, v7EyeY, 0.9, // central snout guard
      -0.34, v7EyeY, -0.6, // rear head guard
    ], 3))

    const mesh = new Mesh(geometry, new MeshBasicMaterial())
    mesh.name = 'WhiteDragon_Head_v7'
    mesh.morphTargetInfluences = [0.37]
    const root = new Object3D()
    root.add(mesh)

    const bindings = createDragonMeshEyelidRig(
      root,
      bounds,
      size,
      center,
      modelEyeY,
    )
    expect(bindings).toHaveLength(1)

    const positions = mesh.geometry.getAttribute('position')
    const before = Array.from(positions.array)
    const jawBefore = mesh.morphTargetInfluences[0]

    applyDragonMeshEyelidRig(bindings, 1, 0)

    const after = Array.from(positions.array)
    expect(after.slice(0, 3)).not.toEqual(before.slice(0, 3))
    expect(after.slice(3, 6)).toEqual(before.slice(3, 6))
    expect(after.slice(6, 9)).toEqual(before.slice(6, 9))
    expect(after.slice(9, 12)).toEqual(before.slice(9, 12))
    expect(mesh.morphTargetInfluences[0]).toBe(jawBefore)
  })
})
