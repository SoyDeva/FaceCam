import type { Object3D } from 'three'
import type { DragonExpressionState } from './dragonExpressions'
import { StaticDragonRenderer } from './StaticDragonRenderer'

const HEAD_NODE_NAME = 'FaceCamHeadStatic'
const NEUTRAL_MOUTH_NODE_NAME = 'FaceCamNeutralMouth'
const OPEN_MOUTH_NODE_NAME = 'FaceCamOpenMouth'

// v17 keeps the exact neutral outer mouth visible at every jaw value and
// deforms that same topology continuously with jawOpen. The open-source mesh is
// no longer an exterior replacement; it is only the oral cavity behind the
// lips/jaw. Hysteresis therefore controls cavity visibility only.
export const DUAL_TOPOLOGY_ENTER_JAW = 0.08
export const DUAL_TOPOLOGY_EXIT_JAW = 0.03

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
const patchMarker = Symbol.for('facecam.regionalHybridRuntime.v17')
const prototype = StaticDragonRenderer.prototype as unknown as RendererPrototype & Record<PropertyKey, unknown>

export function resolveDualTopologyJaw(
  jawOpen: number,
  wasOpen: boolean,
): { openActive: boolean; morphJaw: number } {
  const jaw = Math.min(1, Math.max(0, jawOpen))
  let openActive = wasOpen

  if (!openActive && jaw >= DUAL_TOPOLOGY_ENTER_JAW) openActive = true
  if (openActive && jaw <= DUAL_TOPOLOGY_EXIT_JAW) openActive = false

  // The outer neutral jaw now owns its native transferred jawOpen morph, so it
  // must receive the real continuous value even while the cavity is hidden.
  return { openActive, morphJaw: jaw }
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

    // v17: head + neutral outer jaw are always present. Only the deep cavity is
    // conditionally revealed behind them. This removes the topology seam that
    // produced the detached/serrated mouths in v13-v16.
    state.headRoot.visible = true
    state.neutralMouthRoot.visible = true
    state.openMouthRoot.visible = resolved.openActive

    originalApplyExpression.call(this, {
      ...expression,
      jawOpen: resolved.morphJaw,
    })
  }
}

installRegionalHybridRuntime()
