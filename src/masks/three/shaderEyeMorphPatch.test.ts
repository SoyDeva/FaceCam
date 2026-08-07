import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  type WebGLRenderer,
} from 'three'
import { describe, expect, it } from 'vitest'
import {
  applyAuthoredEyeShader,
  attachAuthoredEyeShader,
  estimateBlinkClosureGain,
} from './shaderEyeMorphPatch'

function riggedMesh(): Mesh {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([
    -1, 2, 3,
    1, 2, 3,
  ], 3))
  geometry.setAttribute('normal', new Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
  ], 3))
  geometry.morphTargetsRelative = true
  geometry.morphAttributes.position = [
    new Float32BufferAttribute([0, -2, 0, 0, -2, 0], 3),
    new Float32BufferAttribute([0, -0.5, 0.1, 0, 0, 0], 3),
    new Float32BufferAttribute([0, 0, 0, 0, -0.4, 0.1], 3),
  ]
  geometry.morphAttributes.normal = [
    new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
    new Float32BufferAttribute([0.1, 0, 0, 0, 0, 0], 3),
    new Float32BufferAttribute([0, 0, 0, -0.1, 0, 0], 3),
  ]

  const mesh = new Mesh(geometry, new MeshStandardMaterial())
  mesh.morphTargetDictionary = {
    jawOpen: 0,
    eyeBlinkLeft: 1,
    eyeBlinkRight: 2,
  }
  mesh.morphTargetInfluences = [0, 0, 0]
  return mesh
}

describe('authored eyelid shader path', () => {
  it('derives the gain required for upper and lower authored lid surfaces to meet', () => {
    const base = new Float32BufferAttribute([
      -0.3, 1, 0, -0.1, 1, 0, 0.1, 1, 0, 0.3, 1, 0,
      -0.3, 0, 0, -0.1, 0, 0, 0.1, 0, 0, 0.3, 0, 0,
    ], 3)
    const delta = new Float32Array([
      0, -0.2, 0, 0, -0.2, 0, 0, -0.2, 0, 0, -0.2, 0,
      0, 0.2, 0, 0, 0.2, 0, 0, 0.2, 0, 0, 0.2, 0,
    ])

    // Gap 1.0 / combined travel 0.4 = 2.5; add the 8% closure margin.
    expect(estimateBlinkClosureGain(base, delta)).toBeCloseTo(2.7, 5)
  })

  it('attaches the exact authored eye deltas as vertex attributes', () => {
    const root = new Object3D()
    const mesh = riggedMesh()
    root.add(mesh)

    const bindings = attachAuthoredEyeShader(root)
    expect(bindings).toHaveLength(1)

    const left = mesh.geometry.getAttribute('facecamBlinkLeftPosition') as Float32BufferAttribute
    const right = mesh.geometry.getAttribute('facecamBlinkRightPosition') as Float32BufferAttribute
    const morphPositions = mesh.geometry.morphAttributes.position!
    expect(Array.from(left.array)).toEqual(Array.from(morphPositions[1].array))
    expect(Array.from(right.array)).toEqual(Array.from(morphPositions[2].array))
  })

  it('injects the eye attributes into the vertex shader and updates uniforms independently', () => {
    const root = new Object3D()
    const mesh = riggedMesh()
    root.add(mesh)
    const bindings = attachAuthoredEyeShader(root)
    const material = mesh.material as MeshStandardMaterial

    const shader = {
      uniforms: {},
      vertexShader: [
        '#include <common>',
        '#include <beginnormal_vertex>',
        '#include <begin_vertex>',
      ].join('\n'),
      fragmentShader: '',
    }
    material.onBeforeCompile(shader as never, {} as WebGLRenderer)

    expect(shader.vertexShader).toContain('facecamBlinkLeftPosition')
    expect(shader.vertexShader).toContain('facecamBlinkRightPosition')
    expect(shader.vertexShader).toContain('transformed += facecamBlinkLeftPosition')
    expect(shader.vertexShader).toContain('objectNormal += facecamBlinkLeftNormal')

    // This tiny synthetic rig has fewer than eight moving vertices, so its
    // safety fallback gain remains 1.0 and the raw channel values are preserved.
    applyAuthoredEyeShader(bindings, 1, 0.25)
    expect(bindings[0].leftUniform.value).toBe(1)
    expect(bindings[0].rightUniform.value).toBe(0.25)

    mesh.morphTargetInfluences![0] = 0.73
    applyAuthoredEyeShader(bindings, 0, 1)
    expect(mesh.morphTargetInfluences![0]).toBe(0.73)
    expect(bindings[0].leftUniform.value).toBe(0)
    expect(bindings[0].rightUniform.value).toBe(1)
  })
})
