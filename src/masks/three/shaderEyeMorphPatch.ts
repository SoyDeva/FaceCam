import {
  BufferAttribute,
  Float32BufferAttribute,
  Material,
  Mesh,
  type Object3D,
} from 'three'
import {
  StaticDragonRenderer,
  type StaticDragonCalibration,
} from './StaticDragonRenderer'
import type { StaticDragonHeadCalibration } from './headCalibration'
import type { StaticDragonPoseEstimate } from './staticPose'

interface EyeUniform {
  value: number
}

export interface EyeShaderBinding {
  leftUniform: EyeUniform
  rightUniform: EyeUniform
  leftGain: number
  rightGain: number
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

export interface EyeShaderDebugState {
  installed: boolean
  rendererBindings: number
  compiledPrograms: number
  lastLeft: number
  lastRight: number
  leftGain: number
  rightGain: number
  buildSha: string
}

const bindingsByRenderer = new WeakMap<StaticDragonRenderer, EyeShaderBinding[]>()
const debugState: EyeShaderDebugState = {
  installed: false,
  rendererBindings: 0,
  compiledPrograms: 0,
  lastLeft: 0,
  lastRight: 0,
  leftGain: 1,
  rightGain: 1,
  buildSha: import.meta.env.VITE_FACECAM_BUILD_SHA ?? 'dev',
}
let installed = false

const MOTION_EPSILON = 1e-6
const MAX_AUTHORED_BLINK_GAIN = 3.25
const CLOSURE_MARGIN = 1.08

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function findMorphIndex(dictionary: Record<string, number>, names: readonly string[]): number | undefined {
  for (const name of names) {
    const exact = dictionary[name]
    if (exact !== undefined) return exact
  }

  const normalized = new Map(
    Object.entries(dictionary).map(([name, index]) => [name.toLowerCase().replace(/[^a-z0-9]/g, ''), index]),
  )
  for (const name of names) {
    const index = normalized.get(name.toLowerCase().replace(/[^a-z0-9]/g, ''))
    if (index !== undefined) return index
  }
  return undefined
}

function extractDelta(
  base: BufferAttribute,
  morph: BufferAttribute | undefined,
  relative: boolean,
): Float32Array | null {
  if (!morph || morph.count !== base.count || morph.itemSize < 3 || base.itemSize < 3) return null

  const delta = new Float32Array(base.count * 3)
  let hasMotion = false
  for (let vertex = 0; vertex < base.count; vertex += 1) {
    const offset = vertex * 3
    const dx = relative ? morph.getX(vertex) : morph.getX(vertex) - base.getX(vertex)
    const dy = relative ? morph.getY(vertex) : morph.getY(vertex) - base.getY(vertex)
    const dz = relative ? morph.getZ(vertex) : morph.getZ(vertex) - base.getZ(vertex)
    delta[offset] = dx
    delta[offset + 1] = dy
    delta[offset + 2] = dz
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1e-7) hasMotion = true
  }
  return hasMotion ? delta : null
}

function zeroDelta(count: number): Float32Array {
  return new Float32Array(count * 3)
}

/**
 * The v7 blink targets point in the correct anatomical direction but their
 * authored 1.0 amplitude does not cover the visible eyeball. Derive the extra
 * amplitude from the target itself instead of guessing eye coordinates:
 * - vertices moving downward represent the upper closing surface;
 * - vertices moving upward represent the lower closing surface;
 * - solve the gain at which those weighted surfaces meet;
 * - cross-check it against the vertical span/travel of the authored target.
 *
 * The result is deliberately capped. We only amplify vertices already present
 * in the official eye morph; no cheek, snout or jaw vertices are selected here.
 */
export function estimateBlinkClosureGain(base: BufferAttribute, delta: Float32Array): number {
  if (base.itemSize < 3 || delta.length < base.count * 3) return 1

  let downwardWeight = 0
  let downwardY = 0
  let downwardDy = 0
  let upwardWeight = 0
  let upwardY = 0
  let upwardDy = 0
  let movedMinY = Number.POSITIVE_INFINITY
  let movedMaxY = Number.NEGATIVE_INFINITY
  let maxVerticalTravel = 0
  let movedVertices = 0

  for (let vertex = 0; vertex < base.count; vertex += 1) {
    const offset = vertex * 3
    const dx = delta[offset]
    const dy = delta[offset + 1]
    const dz = delta[offset + 2]
    const magnitude = Math.hypot(dx, dy, dz)
    if (magnitude <= MOTION_EPSILON) continue

    movedVertices += 1
    const y = base.getY(vertex)
    movedMinY = Math.min(movedMinY, y)
    movedMaxY = Math.max(movedMaxY, y)
    maxVerticalTravel = Math.max(maxVerticalTravel, Math.abs(dy))

    // Ignore almost-horizontal motion when estimating lid convergence. It is
    // still preserved in the actual morph; it simply does not define closure.
    if (Math.abs(dy) < magnitude * 0.2 || Math.abs(dy) <= MOTION_EPSILON) continue

    const weight = Math.abs(dy)
    if (dy < 0) {
      downwardWeight += weight
      downwardY += y * weight
      downwardDy += dy * weight
    } else {
      upwardWeight += weight
      upwardY += y * weight
      upwardDy += dy * weight
    }
  }

  if (movedVertices < 8 || maxVerticalTravel <= MOTION_EPSILON) return 1

  let solvedGain = 1
  if (downwardWeight > MOTION_EPSILON && upwardWeight > MOTION_EPSILON) {
    const upperY = downwardY / downwardWeight
    const lowerY = upwardY / upwardWeight
    const upperDy = downwardDy / downwardWeight
    const lowerDy = upwardDy / upwardWeight
    const gap = Math.abs(upperY - lowerY)
    const closingTravel = Math.abs(lowerDy - upperDy)
    if (gap > MOTION_EPSILON && closingTravel > MOTION_EPSILON) {
      solvedGain = gap / closingTravel * CLOSURE_MARGIN
    }
  }

  const movedSpan = movedMaxY - movedMinY
  const spanGain = movedSpan > MOTION_EPSILON
    ? movedSpan / (2 * maxVerticalTravel) * CLOSURE_MARGIN
    : 1

  const derived = Math.max(1, solvedGain, spanGain)
  return clamp(derived, 1, MAX_AUTHORED_BLINK_GAIN)
}

function installMaterialEyeShader(
  material: Material,
  bindings: EyeShaderBinding[],
  leftGain: number,
  rightGain: number,
): void {
  const leftUniform: EyeUniform = { value: 0 }
  const rightUniform: EyeUniform = { value: 0 }
  const previousCompile = material.onBeforeCompile
  const previousCacheKey = material.customProgramCacheKey.bind(material)

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer)
    shader.uniforms.facecamBlinkLeft = leftUniform
    shader.uniforms.facecamBlinkRight = rightUniform

    const declarations = `
attribute vec3 facecamBlinkLeftPosition;
attribute vec3 facecamBlinkRightPosition;
attribute vec3 facecamBlinkLeftNormal;
attribute vec3 facecamBlinkRightNormal;
uniform float facecamBlinkLeft;
uniform float facecamBlinkRight;
`

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>${declarations}`,
    )
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>\nobjectNormal += facecamBlinkLeftNormal * facecamBlinkLeft + facecamBlinkRightNormal * facecamBlinkRight;`,
    )
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\ntransformed += facecamBlinkLeftPosition * facecamBlinkLeft + facecamBlinkRightPosition * facecamBlinkRight;`,
    )

    debugState.compiledPrograms += 1
  }

  material.customProgramCacheKey = () => `${previousCacheKey()}|facecam-authored-eyelids-v2`
  material.needsUpdate = true
  bindings.push({ leftUniform, rightUniform, leftGain, rightGain })
}

export function attachAuthoredEyeShader(root: Object3D | null): EyeShaderBinding[] {
  if (!root) return []

  const bindings: EyeShaderBinding[] = []
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return

    const dictionary = object.morphTargetDictionary
    const position = object.geometry.getAttribute('position') as BufferAttribute | undefined
    const normal = object.geometry.getAttribute('normal') as BufferAttribute | undefined
    const morphPositions = object.geometry.morphAttributes.position as BufferAttribute[] | undefined
    const morphNormals = object.geometry.morphAttributes.normal as BufferAttribute[] | undefined
    if (!dictionary || !position || !normal || !morphPositions) return

    const leftIndex = findMorphIndex(dictionary, ['eyeBlinkLeft', 'blinkLeft'])
    const rightIndex = findMorphIndex(dictionary, ['eyeBlinkRight', 'blinkRight'])
    if (leftIndex === undefined || rightIndex === undefined) return

    const relative = object.geometry.morphTargetsRelative
    const leftPosition = extractDelta(position, morphPositions[leftIndex], relative)
    const rightPosition = extractDelta(position, morphPositions[rightIndex], relative)
    if (!leftPosition || !rightPosition) return

    const leftNormal = extractDelta(normal, morphNormals?.[leftIndex], relative) ?? zeroDelta(normal.count)
    const rightNormal = extractDelta(normal, morphNormals?.[rightIndex], relative) ?? zeroDelta(normal.count)
    const leftGain = estimateBlinkClosureGain(position, leftPosition)
    const rightGain = estimateBlinkClosureGain(position, rightPosition)

    object.geometry.setAttribute('facecamBlinkLeftPosition', new Float32BufferAttribute(leftPosition, 3))
    object.geometry.setAttribute('facecamBlinkRightPosition', new Float32BufferAttribute(rightPosition, 3))
    object.geometry.setAttribute('facecamBlinkLeftNormal', new Float32BufferAttribute(leftNormal, 3))
    object.geometry.setAttribute('facecamBlinkRightNormal', new Float32BufferAttribute(rightNormal, 3))

    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      installMaterialEyeShader(material, bindings, leftGain, rightGain)
    }
  })

  debugState.leftGain = bindings.length
    ? Math.max(...bindings.map((binding) => binding.leftGain))
    : 1
  debugState.rightGain = bindings.length
    ? Math.max(...bindings.map((binding) => binding.rightGain))
    : 1
  return bindings
}

export function applyAuthoredEyeShader(
  bindings: readonly EyeShaderBinding[],
  leftValue: number,
  rightValue: number,
): void {
  const left = clamp01(leftValue)
  const right = clamp01(rightValue)
  for (const binding of bindings) {
    binding.leftUniform.value = left * binding.leftGain
    binding.rightUniform.value = right * binding.rightGain
  }
  debugState.lastLeft = left
  debugState.lastRight = right
}

export function getEyeShaderDebugState(): EyeShaderDebugState {
  return { ...debugState }
}

/**
 * Three/WebGL on the affected browser renders jawOpen (morph layer 0) but the
 * authored eyeBlink layers 1/2 remain visually static. This compatibility path
 * feeds the exact v7 eye POSITION/NORMAL deltas to custom vertex attributes and
 * applies them inside the material vertex shader. The native eye morph weights
 * are kept at zero to avoid double deformation; jawOpen stays completely native.
 */
export function installStaticDragonEyeShaderPatch(): void {
  if (installed) return
  installed = true
  debugState.installed = true

  const prototype = StaticDragonRenderer.prototype as unknown as PatchableRendererPrototype
  const originalLoad = prototype.load
  const originalRender = prototype.render

  prototype.load = async function patchedLoad(file: Blob): Promise<void> {
    await originalLoad.call(this, file)
    debugState.rendererBindings = 0
    debugState.compiledPrograms = 0
    debugState.leftGain = 1
    debugState.rightGain = 1
    const root = (this as unknown as RendererInternals).modelRoot
    const bindings = attachAuthoredEyeShader(root)
    bindingsByRenderer.set(this, bindings)
    debugState.rendererBindings = bindings.length
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

    applyAuthoredEyeShader(bindings, pose.blinkLeft, pose.blinkRight)
    return originalRender.call(
      this,
      { ...pose, blinkLeft: 0, blinkRight: 0 },
      calibration,
      mirrored,
      headCalibration,
    )
  }
}
