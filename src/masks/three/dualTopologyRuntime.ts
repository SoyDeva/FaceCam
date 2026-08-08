import type { Object3D } from 'three'
import type { DragonExpressionState } from './dragonExpressions'
import { StaticDragonRenderer } from './StaticDragonRenderer'

const HEAD_NODE_NAME = 'FaceCamHeadStatic'
const NEUTRAL_MOUTH_NODE_NAME = 'FaceCamNeutralMouth'
const OPEN_MOUTH_NODE_NAME = 'FaceCamOpenMouth'

// v18 never stretches the exterior mouth. The exact neutral lower jaw is a
// separate rigid mesh that rotates around an anatomical hinge. The authored
// open-source topology is cavity-only and is revealed behind the rigid jaw.
export const DUAL_TOPOLOGY_ENTER_JAW = 0.08
export const DUAL_TOPOLOGY_EXIT_JAW = 0.03
export const RIGID_JAW_HINGE_Y = 0.305
export const RIGID_JAW_HINGE_Z = 0.145
export const RIGID_JAW_MAX_ANGLE_RAD = 16 * Math.PI / 180

// The cavity comes from the old open-mouth topology. Driving that topology at
// the same gain as the rigid exterior jaw exposes too much of its lateral
// teeth/cheek region and makes the mouth look wide and crooked. Keep the real
// jaw rotation, but present the oral interior more conservatively and slightly
// recessed behind the exact neutral lips.
export const ORAL_CAVITY_MORPH_GAIN = 0.72
export const ORAL_CAVITY_MORPH_MAX = 0.52
export const ORAL_CAVITY_MIN_SCALE_X = 0.86
export const ORAL_CAVITY_MAX_RECESS_Z = 0.024

interface RegionalHybridState {
  headRoot: Object3D
  neutralMouthRoot: Object3D
  openMouthRoot: Object3D
  openActive: boolean
  neutralBaseY: number
  neutralBaseZ: number
  neutralBaseRotationX: number
  openBaseZ: number
  openBaseScaleX: number
}

interface RendererPrototype {
  load(this: StaticDragonRenderer, file: Blob): Promise<void>
  applyExpression(this: StaticDragonRenderer, expression: DragonExpressionState): void
}

interface RendererPrivateView {
  modelRoot: Object3D | null
}

const states = new WeakMap<StaticDragonRenderer, RegionalHybridState>()
const patchMarker = Symbol.for('facecam.regionalHybridRuntime.v18')
const prototype = StaticDragonRenderer.prototype as unknown as RendererPrototype & Record<PropertyKey, unknown>

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0))
  return amount * amount * (3 - 2 * amount)
}

export function resolveOralCavityPresentation(
  jawOpen: number,
): { morphJaw: number; scaleX: number; recessZ: number } {
  const jaw = clamp01(jawOpen)
  const presentation = smoothstep(DUAL_TOPOLOGY_ENTER_JAW, 0.72, jaw)

  return {
    morphJaw: Math.min(ORAL_CAVITY_MORPH_MAX, jaw * ORAL_CAVITY_MORPH_GAIN),
    scaleX: 1 - (1 - ORAL_CAVITY_MIN_SCALE_X) * presentation,
    recessZ: ORAL_CAVITY_MAX_RECESS_Z * presentation,
  }
}

export function resolveDualTopologyJaw(
  jawOpen: number,
  wasOpen: boolean,
): { openActive: boolean; morphJaw: number; jawAngleRad: number } {
  const jaw = clamp01(jawOpen)
  let openActive = wasOpen

  if (!openActive && jaw >= DUAL_TOPOLOGY_ENTER_JAW) openActive = true
  if (openActive && jaw <= DUAL_TOPOLOGY_EXIT_JAW) openActive = false

  return {
    openActive,
    morphJaw: resolveOralCavityPresentation(jaw).morphJaw,
    jawAngleRad: jaw * RIGID_JAW_MAX_ANGLE_RAD,
  }
}

export function rigidJawPivotOffset(angleRad: number): { y: number; z: number } {
  const cosine = Math.cos(angleRad)
  const sine = Math.sin(angleRad)

  return {
    y: RIGID_JAW_HINGE_Y * (1 - cosine) + RIGID_JAW_HINGE_Z * sine,
    z: RIGID_JAW_HINGE_Z * (1 - cosine) - RIGID_JAW_HINGE_Y * sine,
  }
}

function installRegionalHybridRuntime(): void {
  if (prototype[patchMarker]) return
  prototype[patchMarker] = true

  const originalLoad = prototype.load
  const originalApplyExpression = prototype.applyExpression

  prototype.load = async function loadWithRegionalHybrid(file: Blob): Promise<void> {
    await originalLoad.call(this, file)

    const root = (this as unknown as RendererPrivateView).modelRoot
    const headRoot = root?.getObjectByName(HEAD_NODE_NAME) ?? null
    const neutralMouthRoot = root?.getObjectByName(NEUTRAL_MOUTH_NODE_NAME) ?? null
    const openMouthRoot = root?.getObjectByName(OPEN_MOUTH_NODE_NAME) ?? null

    if (!headRoot || !neutralMouthRoot || !openMouthRoot) {
      states.delete(this)
      return
    }

    headRoot.visible = true
    neutralMouthRoot.visible = true
    openMouthRoot.visible = false
    states.set(this, {
      headRoot,
      neutralMouthRoot,
      openMouthRoot,
      openActive: false,
      neutralBaseY: neutralMouthRoot.position.y,
      neutralBaseZ: neutralMouthRoot.position.z,
      neutralBaseRotationX: neutralMouthRoot.rotation.x,
      openBaseZ: openMouthRoot.position.z,
      openBaseScaleX: openMouthRoot.scale.x,
    })
  }

  prototype.applyExpression = function applyExpressionWithRegionalHybrid(
    expression: DragonExpressionState,
  ): void {
    const state = states.get(this)
    if (!state) {
      originalApplyExpression.call(this, expression)
      return
    }

    const resolved = resolveDualTopologyJaw(expression.jawOpen, state.openActive)
    const cavity = resolveOralCavityPresentation(expression.jawOpen)
    state.openActive = resolved.openActive

    // Rotate the exact neutral lower jaw around the fixed hinge. Position is
    // compensated so the hinge point itself stays stationary in local space.
    const pivotOffset = rigidJawPivotOffset(resolved.jawAngleRad)
    state.neutralMouthRoot.rotation.x = state.neutralBaseRotationX + resolved.jawAngleRad
    state.neutralMouthRoot.position.y = state.neutralBaseY + pivotOffset.y
    state.neutralMouthRoot.position.z = state.neutralBaseZ + pivotOffset.z

    // Keep the authored cavity visually inside the exact neutral lip line.
    // Narrowing only the cavity (never the exterior jaw) hides the lateral
    // open-topology teeth that produced the wide/crooked mouth in live video.
    state.openMouthRoot.scale.x = state.openBaseScaleX * cavity.scaleX
    state.openMouthRoot.position.z = state.openBaseZ - cavity.recessZ

    state.headRoot.visible = true
    state.neutralMouthRoot.visible = true
    state.openMouthRoot.visible = resolved.openActive

    // Only the cavity owns jawOpen morphs in v18. Its morph is deliberately
    // lower-gain than the rigid jaw rotation so the tongue/teeth stay natural
    // while the exact exterior jaw still follows the user's opening.
    originalApplyExpression.call(this, {
      ...expression,
      jawOpen: cavity.morphJaw,
    })
  }
}

installRegionalHybridRuntime()
