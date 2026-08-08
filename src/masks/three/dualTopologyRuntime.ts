import type { Object3D } from 'three'
import type { DragonExpressionState } from './dragonExpressions'
import { StaticDragonRenderer } from './StaticDragonRenderer'

const HEAD_NODE_NAME = 'FaceCamHeadStatic'
const NEUTRAL_MOUTH_NODE_NAME = 'FaceCamNeutralMouth'
const OPEN_MOUTH_NODE_NAME = 'FaceCamOpenMouth'
const UPPER_BRIDGE_NODE_NAME = 'FaceCamUpperMuzzleBridge'

// v23 abandons the v21/v22 cut-away strategy. The approved v20 head, eyes,
// neutral mouth and authored Abierto_Dragon open mouth remain untouched. A
// dedicated jawOpen-driven bridge is added only behind the upper source muzzle
// so its attachment to the static head stays visually closed from front/profile
// views without altering the approved lower mouth.
export const DUAL_TOPOLOGY_ENTER_JAW = 0.14
export const DUAL_TOPOLOGY_EXIT_JAW = 0.055
export const DUAL_TOPOLOGY_OPEN_MORPH_START = 0.32

interface SourceMouthState {
  headRoot: Object3D
  neutralMouthRoot: Object3D
  openMouthRoot: Object3D
  upperBridgeRoot: Object3D
  openActive: boolean
}

interface RendererPrototype {
  load(this: StaticDragonRenderer, file: Blob): Promise<void>
  applyExpression(this: StaticDragonRenderer, expression: DragonExpressionState): void
}

interface RendererPrivateView {
  modelRoot: Object3D | null
}

const states = new WeakMap<StaticDragonRenderer, SourceMouthState>()
const patchMarker = Symbol.for('facecam.sourceMouthRuntime.v23')
const prototype = StaticDragonRenderer.prototype as unknown as RendererPrototype & Record<PropertyKey, unknown>

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function resolveDualTopologyJaw(
  jawOpen: number,
  wasOpen: boolean,
): { openActive: boolean; morphJaw: number } {
  const jaw = clamp01(jawOpen)
  let openActive = wasOpen

  if (!openActive && jaw >= DUAL_TOPOLOGY_ENTER_JAW) openActive = true
  if (openActive && jaw <= DUAL_TOPOLOGY_EXIT_JAW) openActive = false

  if (!openActive) {
    return { openActive: false, morphJaw: 0 }
  }

  const progress = clamp01(
    (jaw - DUAL_TOPOLOGY_ENTER_JAW) / (1 - DUAL_TOPOLOGY_ENTER_JAW),
  )
  const eased = progress * progress * (3 - 2 * progress)
  const morphJaw = DUAL_TOPOLOGY_OPEN_MORPH_START
    + (1 - DUAL_TOPOLOGY_OPEN_MORPH_START) * eased

  return { openActive: true, morphJaw }
}

function installSourceMouthRuntime(): void {
  if (prototype[patchMarker]) return
  prototype[patchMarker] = true

  const originalLoad = prototype.load
  const originalApplyExpression = prototype.applyExpression

  prototype.load = async function loadWithSourceMouth(file: Blob): Promise<void> {
    await originalLoad.call(this, file)

    const root = (this as unknown as RendererPrivateView).modelRoot
    const headRoot = root?.getObjectByName(HEAD_NODE_NAME) ?? null
    const neutralMouthRoot = root?.getObjectByName(NEUTRAL_MOUTH_NODE_NAME) ?? null
    const openMouthRoot = root?.getObjectByName(OPEN_MOUTH_NODE_NAME) ?? null
    const upperBridgeRoot = root?.getObjectByName(UPPER_BRIDGE_NODE_NAME) ?? null

    if (!headRoot || !neutralMouthRoot || !openMouthRoot || !upperBridgeRoot) {
      states.delete(this)
      return
    }

    neutralMouthRoot.position.set(0, 0, 0)
    neutralMouthRoot.rotation.set(0, 0, 0)
    neutralMouthRoot.scale.set(1, 1, 1)
    openMouthRoot.position.set(0, 0, 0)
    openMouthRoot.rotation.set(0, 0, 0)
    openMouthRoot.scale.set(1, 1, 1)
    upperBridgeRoot.position.set(0, 0, 0)
    upperBridgeRoot.rotation.set(0, 0, 0)
    upperBridgeRoot.scale.set(1, 1, 1)

    headRoot.visible = true
    neutralMouthRoot.visible = true
    openMouthRoot.visible = false
    upperBridgeRoot.visible = false
    states.set(this, {
      headRoot,
      neutralMouthRoot,
      openMouthRoot,
      upperBridgeRoot,
      openActive: false,
    })
  }

  prototype.applyExpression = function applyExpressionWithSourceMouth(
    expression: DragonExpressionState,
  ): void {
    const state = states.get(this)
    if (!state) {
      originalApplyExpression.call(this, expression)
      return
    }

    const resolved = resolveDualTopologyJaw(expression.jawOpen, state.openActive)
    state.openActive = resolved.openActive

    state.headRoot.visible = true
    state.neutralMouthRoot.visible = !resolved.openActive
    state.openMouthRoot.visible = resolved.openActive
    state.upperBridgeRoot.visible = resolved.openActive

    // The bridge carries its own `jawOpen` morph target, so the existing
    // StaticDragonRenderer morph dispatcher drives it with the exact same
    // value as the authored open-mouth source.
    originalApplyExpression.call(this, {
      ...expression,
      jawOpen: resolved.morphJaw,
    })
  }
}

installSourceMouthRuntime()
