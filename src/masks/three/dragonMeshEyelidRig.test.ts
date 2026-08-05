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
  resolveNativeDragonBlinkInfluence,
} from './dragonMeshEyelidRig'

function riggedHead() {
  const root = new Object3D()
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  )
  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.morphTargetDictionary = {
    jawOpen: 0,
    eyeBlinkLeft: 1,
    eyeBlinkRight: 2,
  }
  mesh.morphTargetInfluences = [0.37, 0, 0]
  root.add(mesh)
  return { root, mesh, positions: Array.from(geometry.getAttribute('position').array) }
}

describe('native dragon blink morphs', () => {
  it('keeps neutral noise open and reaches the measured full travel', () => {
    expect(resolveNativeDragonBlinkInfluence(0.03)).toBe(0)
    expect(resolveNativeDragonBlinkInfluence(0.5)).toBeGreaterThan(1.7)
    expect(resolveNativeDragonBlinkInfluence(1)).toBeCloseTo(4.5)
  })

  it('binds existing morphs without creating or deforming geometry', () => {
    const { root, mesh, positions } = riggedHead()
    const originalChildren = root.children.length
    const bindings = createDragonMeshEyelidRig(
      root,
      new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
      new Vector3(2, 2, 2),
      new Vector3(),
      0,
    )

    expect(bindings).toHaveLength(1)
    expect(root.children).toHaveLength(originalChildren)
    expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual(positions)
  })

  it('controls each real eyelid independently and leaves the jaw unchanged', () => {
    const { root, mesh } = riggedHead()
    const bindings = createDragonMeshEyelidRig(
      root,
      new Box3(),
      new Vector3(),
      new Vector3(),
      0,
    )

    applyDragonMeshEyelidRig(bindings, 1, 0.5)

    expect(mesh.morphTargetInfluences?.[0]).toBe(0.37)
    expect(mesh.morphTargetInfluences?.[1]).toBeCloseTo(4.5)
    expect(mesh.morphTargetInfluences?.[2]).toBeGreaterThan(1.7)
    expect(mesh.morphTargetInfluences?.[2]).toBeLessThan(4.5)
  })
})
