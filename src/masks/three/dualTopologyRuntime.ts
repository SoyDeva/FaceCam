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

interface RegionalHybridState {
  headRoot: Object3D
  neutralMouthRoot: Object3D
  openMouthRoot: Object3D
  openActive: boolean
  neutralBaseY: number
  neutralBaseZ: number
  neutralBaseRotationX: number
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

export function resolveDualTopologyJaw(
  jawOpen: number,
  wasOpen: boolean,
): { openActive: boolean; morphJaw: number; jawAngleRad: number } {
  const jaw = Math.min(1, Math.max(0, jawOpen))
  let openActive = wasOpen

  if (!openActive && jaw >= DUAL_TOPOLOGY_ENTER_JAW) openActive = true
  if (openActive && jaw <= DUAL_TOPOLOGY_EXIT_JAW) openActive = false

  return {
    openActive,
    morphJaw: jaw,
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
    state.openActive = resolved.openActive

    // Rotate the exact neutral lower jaw around the fixed hinge. Position is
    // compensated so the hinge point itself stays stationary in local space.
    const pivotOffset = rigidJawPivotOffset(resolved.jawAngleRad)
    state.neutralMouthRoot.rotation.x = state.neutralBaseRotationX + resolved.jawAngleRad
    state.neutralMouthRoot.position.y = state.neutralBaseY + pivotOffset.y
    state.neutralMouthRoot.position.z = state.neutralBaseZ + pivotOffset.z

    state.headRoot.visible = true
    state.neutralMouthRoot.visible = true
    state.openMouthRoot.visible = resolved.openActive

    // Only the cavity owns jawOpen morphs in v18. The exterior neutral jaw is
    // moved rigidly above, so the renderer cannot stretch the hocico again.
    originalApplyExpression.call(this, {
      ...expression,
      jawOpen: resolved.morphJaw,
    })
  }
}

installRegionalHybridRuntime()
