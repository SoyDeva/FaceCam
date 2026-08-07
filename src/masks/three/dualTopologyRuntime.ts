import type { Object3D } from 'three'
import type { DragonExpressionState } from './dragonExpressions'
import { StaticDragonRenderer } from './StaticDragonRenderer'

const HEAD_NODE_NAME = 'FaceCamHeadStatic'
const NEUTRAL_MOUTH_NODE_NAME = 'FaceCamNeutralMouth'
const OPEN_MOUTH_NODE_NAME = 'FaceCamOpenMouth'

// v13 keeps the real neutral head permanently visible. Only the oral region
// switches topology, so opening the mouth cannot change the forehead, eyes,
// cheeks, horns or the overall facial proportions.
export const DUAL_TOPOLOGY_ENTER_JAW = 0.12
export const DUAL_TOPOLOGY_EXIT_JAW = 0.045
export const DUAL_TOPOLOGY_OPEN_MORPH_START = 0.2

interface RegionalHybridState {
  headRoot: Object3D
  neutralMouthRoot: Object3D
  openMouthRoot: Object3D
  openActive: boolean
}

interface RendererPrototype {
  load(this: StaticDragonRenderer, file: Blob): Promise<void>
  applyExpression(this: StaticDragonRenderer, expression: DragonExpressionState): void
}

interface RendererPrivateView {
  modelRoot: Object3D | null
}

const states = new WeakMap<StaticDragonRenderer, RegionalHybridState>()
const patchMarker = Symbol.for('facecam.regionalHybridRuntime.v13')
const prototype = StaticDragonRenderer.prototype as unknown as RendererPrototype & Record<PropertyKey, unknown>

export function resolveDualTopologyJaw(
  jawOpen: number,
  wasOpen: boolean,
): { openActive: boolean; morphJaw: number } {
  const jaw = Math.min(1, Math.max(0, jawOpen))
  let openActive = wasOpen

  if (!openActive && jaw >= DUAL_TOPOLOGY_ENTER_JAW) openActive = true
  if (openActive && jaw <= DUAL_TOPOLOGY_EXIT_JAW) openActive = false

  if (!openActive) return { openActive: false, morphJaw: 0 }

  const progress = Math.min(
    1,
    Math.max(0, (jaw - DUAL_TOPOLOGY_ENTER_JAW) / (1 - DUAL_TOPOLOGY_ENTER_JAW)),
  )
  const morphJaw = DUAL_TOPOLOGY_OPEN_MORPH_START
    + progress * (1 - DUAL_TOPOLOGY_OPEN_MORPH_START)

  return { openActive: true, morphJaw }
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

    // The neutral head never disappears. Only the mouth patch changes.
    state.headRoot.visible = true
    state.neutralMouthRoot.visible = !resolved.openActive
    state.openMouthRoot.visible = resolved.openActive

    originalApplyExpression.call(this, {
      ...expression,
      jawOpen: resolved.morphJaw,
    })
  }
}

installRegionalHybridRuntime()
