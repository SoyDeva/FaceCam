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
  geometry.morphAttributes.position = [
    new Float32BufferAttribute([0, 0, 0, 0, -0.2, 0, 0, 0, 0], 3),
    new Float32BufferAttribute([0, -0.1, 0, 0, 0, 0, 0, 0, 0], 3),
    new Float32BufferAttribute([0, 0, 0, 0, -0.1, 0, 0, 0, 0], 3),
  ]

  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.morphTargetDictionary = {
    jawOpen: 0,
    eyeBlinkLeft: 1,
    eyeBlinkRight: 2,
  }
  mesh.morphTargetInfluences = [0.37, 0, 0]
  root.add(mesh)

  return {
    root,
    mesh,
    positions: Array.from(geometry.getAttribute('position').array),
    morphPositions: geometry.morphAttributes.position.map((attribute) => Array.from(attribute.array)),
  }
}

describe('dragon GLB v4 native eyelids', () => {
  it('rejects neutral noise and makes ordinary blinks clearly visible', () => {
    expect(resolveNativeDragonBlinkInfluence(0.02)).toBe(0)
    expect(resolveNativeDragonBlinkInfluence(0.18)).toBeGreaterThan(0.25)
    expect(resolveNativeDragonBlinkInfluence(0.5)).toBeGreaterThan(0.7)
    expect(resolveNativeDragonBlinkInfluence(1)).toBeCloseTo(1)
  })

  it('binds the GLB morphs without creating or rewriting geometry', () => {
    const { root, mesh, positions, morphPositions } = riggedHead()
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
    expect(mesh.geometry.morphAttributes.position?.map((attribute) => Array.from(attribute.array)))
      .toEqual(morphPositions)
  })

  it('controls each eye independently and leaves the jaw unchanged', () => {
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
    expect(mesh.morphTargetInfluences?.[1]).toBeCloseTo(1)
    expect(mesh.morphTargetInfluences?.[2]).toBeGreaterThan(0.7)
    expect(mesh.morphTargetInfluences?.[2]).toBeLessThan(1)
  })

  it('reopens both eyes without changing the authored morph data', () => {
    const { root, mesh, morphPositions } = riggedHead()
    const bindings = createDragonMeshEyelidRig(
      root,
      new Box3(),
      new Vector3(),
      new Vector3(),
      0,
    )

    applyDragonMeshEyelidRig(bindings, 1, 1)
    applyDragonMeshEyelidRig(bindings, 0, 0)

    expect(mesh.morphTargetInfluences?.[1]).toBe(0)
    expect(mesh.morphTargetInfluences?.[2]).toBe(0)
    expect(mesh.geometry.morphAttributes.position?.map((attribute) => Array.from(attribute.array)))
      .toEqual(morphPositions)
  })
})
