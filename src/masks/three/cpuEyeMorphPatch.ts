import {
  BufferAttribute,
  DynamicDrawUsage,
  Mesh,
  type Object3D,
} from 'three'
import {
  StaticDragonRenderer,
  type StaticDragonCalibration,
} from './StaticDragonRenderer'
import type { StaticDragonHeadCalibration } from './headCalibration'
import type { StaticDragonPoseEstimate } from './staticPose'

interface CpuEyeBinding {
  position: BufferAttribute
  base: Float32Array
  leftDelta: Float32Array | null
  rightDelta: Float32Array | null
  lastLeft: number
  lastRight: number
}

interface RendererInternals {
  modelRoot: Object3D | null
}

interface PatchableRendererPrototype {
  load(this: StaticDragonRenderer, file: Blob): Promise<void>
  render(
    this: StaticDragonRenderer,
    pose: StaticDragonPoseEstimate,
    calibration: StaticDragonCalibration,
    mirrored: boolean,
    headCalibration: StaticDragonHeadCalibration | null,
  ): boolean
}

const bindingsByRenderer = new WeakMap<StaticDragonRenderer, CpuEyeBinding[]>()
let installed = false

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function findMorphIndex(dictionary: Record<string, number>, names: readonly string[]): number | undefined {
  for (const name of names) {
    const index = dictionary[name]
    if (index !== undefined) return index
  }
  return undefined
}

function extractDelta(
  position: BufferAttribute,
  morph: BufferAttribute | undefined,
  relative: boolean,
): Float32Array | null {
  if (!morph || morph.count !== position.count || morph.itemSize < 3) return null

  const delta = new Float32Array(position.count * 3)
  let hasMotion = false
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const offset = vertex * 3
    const dx = relative ? morph.getX(vertex) : morph.getX(vertex) - position.getX(vertex)
    const dy = relative ? morph.getY(vertex) : morph.getY(vertex) - position.getY(vertex)
    const dz = relative ? morph.getZ(vertex) : morph.getZ(vertex) - position.getZ(vertex)
    delta[offset] = dx
    delta[offset + 1] = dy
    delta[offset + 2] = dz
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1e-7) hasMotion = true
  }
  return hasMotion ? delta : null
}

export function captureCpuEyeBindings(root: Object3D | null): CpuEyeBinding[] {
  if (!root) return []

  const bindings: CpuEyeBinding[] = []
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return

    const dictionary = object.morphTargetDictionary
    const morphPositions = object.geometry.morphAttributes.position as BufferAttribute[] | undefined
    const position = object.geometry.getAttribute('position') as BufferAttribute | undefined
    if (!dictionary || !morphPositions || !position || position.itemSize < 3) return

    const leftIndex = findMorphIndex(dictionary, ['eyeBlinkLeft', 'blinkLeft'])
    const rightIndex = findMorphIndex(dictionary, ['eyeBlinkRight', 'blinkRight'])
    const leftDelta = leftIndex === undefined
      ? null
      : extractDelta(position, morphPositions[leftIndex], object.geometry.morphTargetsRelative)
    const rightDelta = rightIndex === undefined
      ? null
      : extractDelta(position, morphPositions[rightIndex], object.geometry.morphTargetsRelative)
    if (!leftDelta && !rightDelta) return

    const base = new Float32Array(position.count * 3)
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const offset = vertex * 3
      base[offset] = position.getX(vertex)
      base[offset + 1] = position.getY(vertex)
      base[offset + 2] = position.getZ(vertex)
    }

    // The v7 eye deltas are authored correctly, but on the affected runtime the
    // higher morph-texture layers are not producing visible deformation while
    // layer 0 (jawOpen) does. Upload the authored eyelid result as the dynamic
    // base position instead; jawOpen remains a native GPU morph on top of it.
    position.setUsage(DynamicDrawUsage)
    bindings.push({
      position,
      base,
      leftDelta,
      rightDelta,
      lastLeft: Number.NaN,
      lastRight: Number.NaN,
    })
  })
  return bindings
}

export function applyCpuEyeBlink(
  bindings: readonly CpuEyeBinding[],
  leftValue: number,
  rightValue: number,
): void {
  const left = clamp01(leftValue)
  const right = clamp01(rightValue)

  for (const binding of bindings) {
    if (Math.abs(binding.lastLeft - left) < 1e-4 && Math.abs(binding.lastRight - right) < 1e-4) {
      continue
    }

    const array = binding.position.array as Float32Array
    const { base, leftDelta, rightDelta } = binding
    for (let offset = 0; offset < base.length; offset += 1) {
      array[offset] = base[offset]
        + (leftDelta ? leftDelta[offset] * left : 0)
        + (rightDelta ? rightDelta[offset] * right : 0)
    }
    binding.position.needsUpdate = true
    binding.lastLeft = left
    binding.lastRight = right
  }
}

/**
 * Installs a narrow compatibility layer for the v7 eyelids. It does not invent
 * geometry: it applies the exact eyeBlinkLeft/eyeBlinkRight POSITION deltas
 * authored in the installed GLB. Only the two eye channels are removed from
 * the normal GPU morph path; jawOpen and every other renderer feature remain
 * untouched.
 */
export function installStaticDragonCpuEyeMorphPatch(): void {
  if (installed) return
  installed = true

  const prototype = StaticDragonRenderer.prototype as unknown as PatchableRendererPrototype
  const originalLoad = prototype.load
  const originalRender = prototype.render

  prototype.load = async function patchedLoad(file: Blob): Promise<void> {
    await originalLoad.call(this, file)
    const root = (this as unknown as RendererInternals).modelRoot
    bindingsByRenderer.set(this, captureCpuEyeBindings(root))
  }

  prototype.render = function patchedRender(
    pose: StaticDragonPoseEstimate,
    calibration: StaticDragonCalibration,
    mirrored: boolean,
    headCalibration: StaticDragonHeadCalibration | null,
  ): boolean {
    const bindings = bindingsByRenderer.get(this)
    if (!bindings?.length) {
      return originalRender.call(this, pose, calibration, mirrored, headCalibration)
    }

    applyCpuEyeBlink(bindings, pose.blinkLeft, pose.blinkRight)
    return originalRender.call(
      this,
      { ...pose, blinkLeft: 0, blinkRight: 0 },
      calibration,
      mirrored,
      headCalibration,
    )
  }
}
