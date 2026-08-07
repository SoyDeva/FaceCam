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
  buildSha: string
}

const bindingsByRenderer = new WeakMap<StaticDragonRenderer, EyeShaderBinding[]>()
const debugState: EyeShaderDebugState = {
  installed: false,
  rendererBindings: 0,
  compiledPrograms: 0,
  lastLeft: 0,
  lastRight: 0,
  buildSha: import.meta.env.VITE_FACECAM_BUILD_SHA ?? 'dev',
}
let installed = false

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
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

function installMaterialEyeShader(
  material: Material,
  bindings: EyeShaderBinding[],
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

  material.customProgramCacheKey = () => `${previousCacheKey()}|facecam-authored-eyelids-v1`
  material.needsUpdate = true
  bindings.push({ leftUniform, rightUniform })
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

    object.geometry.setAttribute('facecamBlinkLeftPosition', new Float32BufferAttribute(leftPosition, 3))
    object.geometry.setAttribute('facecamBlinkRightPosition', new Float32BufferAttribute(rightPosition, 3))
    object.geometry.setAttribute('facecamBlinkLeftNormal', new Float32BufferAttribute(leftNormal, 3))
    object.geometry.setAttribute('facecamBlinkRightNormal', new Float32BufferAttribute(rightNormal, 3))

    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      installMaterialEyeShader(material, bindings)
    }
  })

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
    binding.leftUniform.value = left
    binding.rightUniform.value = right
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
