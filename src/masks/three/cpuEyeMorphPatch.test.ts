import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { applyCpuEyeBlink, captureCpuEyeBindings } from './cpuEyeMorphPatch'

function riggedMesh(): Mesh {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([
    -1, 2, 3,
    1, 2, 3,
  ], 3))
  geometry.morphTargetsRelative = true
  geometry.morphAttributes.position = [
    new Float32BufferAttribute([0, -2, 0, 0, -2, 0], 3),
    new Float32BufferAttribute([0, -0.5, 0.1, 0, 0, 0], 3),
    new Float32BufferAttribute([0, 0, 0, 0, -0.4, 0.1], 3),
  ]

  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.morphTargetDictionary = {
    jawOpen: 0,
    eyeBlinkLeft: 1,
    eyeBlinkRight: 2,
  }
  mesh.morphTargetInfluences = [0, 0, 0]
  return mesh
}

describe('CPU eyelid compatibility path', () => {
  it('applies the authored left and right deltas independently and restores neutral', () => {
    const root = new Object3D()
    const mesh = riggedMesh()
    root.add(mesh)
    const bindings = captureCpuEyeBindings(root)
    const position = mesh.geometry.getAttribute('position') as Float32BufferAttribute

    expect(bindings).toHaveLength(1)

    applyCpuEyeBlink(bindings, 1, 0)
    expect(Array.from(position.array)).toEqual([
      -1, 1.5, 3.1,
      1, 2, 3,
    ])

    applyCpuEyeBlink(bindings, 0, 1)
    expect(Array.from(position.array)).toEqual([
      -1, 2, 3,
      1, 1.6, 3.1,
    ])

    applyCpuEyeBlink(bindings, 0, 0)
    expect(Array.from(position.array)).toEqual([
      -1, 2, 3,
      1, 2, 3,
    ])
  })

  it('does not write to the native morph influence array used by jawOpen', () => {
    const root = new Object3D()
    const mesh = riggedMesh()
    root.add(mesh)
    const bindings = captureCpuEyeBindings(root)

    mesh.morphTargetInfluences![0] = 0.73
    applyCpuEyeBlink(bindings, 1, 1)

    expect(mesh.morphTargetInfluences![0]).toBe(0.73)
  })
})
