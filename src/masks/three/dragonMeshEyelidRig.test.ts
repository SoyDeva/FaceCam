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
  buildDragonBlueEyeBlinkDeltas,
  createDragonMeshEyelidRig,
  resolveNativeDragonBlinkInfluence,
} from './dragonMeshEyelidRig'

const LEFT_UPPER = 2
const LEFT_LOWER = 3
const RIGHT_UPPER = 4
const RIGHT_LOWER = 5
const LEFT_BROW = 6
const RIGHT_BROW = 7
const NOSE = 8
const CHEEK = 9

function riggedHead() {
  const root = new Object3D()
  const geometry = new BufferGeometry()
  const positions = new Float32Array([
    -0.37539744, 0, -0.48469037,
    0.37539744, 0.97128147, 0.49448565,
    0.1123, 0.4801, 0.3077,
    0.1123, 0.4561, 0.3077,
    -0.1123, 0.4801, 0.3077,
    -0.1123, 0.4561, 0.3077,
    0.1123, 0.56, 0.3077,
    -0.1123, 0.56, 0.3077,
    0, 0.4681, 0.35,
    0.1123, 0.40, 0.3077,
  ])
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.morphTargetsRelative = true

  const targetLength = positions.length
  const jaw = new Float32BufferAttribute(new Float32Array(targetLength), 3)
  const badLeftBrow = new Float32Array(targetLength)
  badLeftBrow[LEFT_BROW * 3 + 1] = -0.05
  const badRightBrow = new Float32Array(targetLength)
  badRightBrow[RIGHT_BROW * 3 + 1] = -0.05
  geometry.morphAttributes.position = [
    jaw,
    new Float32BufferAttribute(badLeftBrow, 3),
    new Float32BufferAttribute(badRightBrow, 3),
  ]
  geometry.morphAttributes.normal = [
    new Float32BufferAttribute(new Float32Array(targetLength), 3),
    new Float32BufferAttribute(new Float32Array(targetLength).fill(0.4), 3),
    new Float32BufferAttribute(new Float32Array(targetLength).fill(0.4), 3),
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
    originalPositions: Array.from(geometry.getAttribute('position').array),
  }
}

function changedY(attribute: Float32BufferAttribute, index: number): number {
  return attribute.getY(index)
}

function closedY(
  position: Float32BufferAttribute,
  morph: Float32BufferAttribute,
  index: number,
): number {
  return position.getY(index) + morph.getY(index)
}

describe('blue dragon eye blink repair', () => {
  it('keeps neutral noise open and reaches one corrected full closure', () => {
    expect(resolveNativeDragonBlinkInfluence(0.03)).toBe(0)
    expect(resolveNativeDragonBlinkInfluence(0.5)).toBeGreaterThan(0.35)
    expect(resolveNativeDragonBlinkInfluence(0.5)).toBeLessThan(1)
    expect(resolveNativeDragonBlinkInfluence(1)).toBeCloseTo(1)
  })

  it('builds movement at the blue-eye height and never at brow height', () => {
    const { mesh } = riggedHead()
    const position = mesh.geometry.getAttribute('position') as Float32BufferAttribute
    const left = new Float32BufferAttribute(
      buildDragonBlueEyeBlinkDeltas(position, 'left'),
      3,
    )

    expect(changedY(left, LEFT_UPPER)).toBeLessThan(0)
    expect(changedY(left, LEFT_LOWER)).toBeGreaterThan(0)
    expect(changedY(left, LEFT_BROW)).toBeCloseTo(0)
    expect(changedY(left, RIGHT_BROW)).toBeCloseTo(0)
    expect(changedY(left, NOSE)).toBeCloseTo(0)
    expect(changedY(left, CHEEK)).toBeCloseTo(0)
  })

  it('collapses each original blue circle while leaving the other eye untouched', () => {
    const { root, mesh, originalPositions } = riggedHead()
    const originalChildren = root.children.length
    const bindings = createDragonMeshEyelidRig(
      root,
      new Box3(),
      new Vector3(),
      new Vector3(),
      0,
    )

    const position = mesh.geometry.getAttribute('position') as Float32BufferAttribute
    const left = mesh.geometry.morphAttributes.position![1] as Float32BufferAttribute
    const right = mesh.geometry.morphAttributes.position![2] as Float32BufferAttribute
    const openSpan = position.getY(LEFT_UPPER) - position.getY(LEFT_LOWER)
    const closedSpan = Math.abs(
      closedY(position, left, LEFT_UPPER) - closedY(position, left, LEFT_LOWER),
    )

    expect(bindings).toHaveLength(1)
    expect(root.children).toHaveLength(originalChildren)
    expect(Array.from(position.array)).toEqual(originalPositions)
    expect(closedSpan).toBeLessThan(openSpan * 0.12)
    expect(changedY(left, RIGHT_UPPER)).toBeCloseTo(0)
    expect(changedY(left, RIGHT_LOWER)).toBeCloseTo(0)
    expect(changedY(right, RIGHT_UPPER)).toBeLessThan(0)
    expect(changedY(right, RIGHT_LOWER)).toBeGreaterThan(0)
    expect(changedY(right, LEFT_UPPER)).toBeCloseTo(0)
    expect(changedY(right, LEFT_LOWER)).toBeCloseTo(0)
  })

  it('removes old brow normal deformation and leaves the jaw unchanged', () => {
    const { root, mesh } = riggedHead()
    const bindings = createDragonMeshEyelidRig(
      root,
      new Box3(),
      new Vector3(),
      new Vector3(),
      0,
    )

    applyDragonMeshEyelidRig(bindings, 1, 0.5)

    const leftNormals = mesh.geometry.morphAttributes.normal![1] as Float32BufferAttribute
    const rightNormals = mesh.geometry.morphAttributes.normal![2] as Float32BufferAttribute
    expect(Array.from(leftNormals.array).every((value) => value === 0)).toBe(true)
    expect(Array.from(rightNormals.array).every((value) => value === 0)).toBe(true)
    expect(mesh.morphTargetInfluences?.[0]).toBe(0.37)
    expect(mesh.morphTargetInfluences?.[1]).toBeCloseTo(1)
    expect(mesh.morphTargetInfluences?.[2]).toBeGreaterThan(0.35)
    expect(mesh.morphTargetInfluences?.[2]).toBeLessThan(1)
  })
})
