import type { Object3D } from 'three'
import type { DragonExpressionState } from './dragonExpressions'
import { StaticDragonRenderer } from './StaticDragonRenderer'

const NEUTRAL_NODE_NAME = 'FaceCamNeutralSource'
const OPEN_NODE_NAME = 'FaceCamOpenRig'

// The authored closed and open source files use different topology. Do not try
// to morph one base mesh all the way into the other at rest. The original
// neutral stays authoritative until a real mouth opening is underway; the
// original open topology then takes over with hysteresis so tracking noise
// cannot make the renderer chatter between meshes.
export const DUAL_TOPOLOGY_ENTER_JAW = 0.12
export const DUAL_TOPOLOGY_EXIT_JAW = 0.045
export const DUAL_TOPOLOGY_OPEN_MORPH_START = 0.2

interface DualTopologyState {
  neutralRoot: Object3D
  openRoot: Object3D
  openActive: boolean
}

interface RendererPrototype {
  load(this: StaticDragonRenderer, file: Blob): Promise<void>
  applyExpression(this: StaticDragonRenderer, expression: DragonExpressionState): void
}

interface RendererPrivateView {
  modelRoot: Object3D | null
}

const states = new WeakMap<StaticDragonRenderer, DualTopologyState>()
const patchMarker = Symbol.for('facecam.dualTopologyRuntime.v12')
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

function installDualTopologyRuntime(): void {
  if (prototype[patchMarker]) return
  prototype[patchMarker] = true

  const originalLoad = prototype.load
  const originalApplyExpression = prototype.applyExpression

  prototype.load = async function loadWithDualTopology(file: Blob): Promise<void> {
    await originalLoad.call(this, file)

    const root = (this as unknown as RendererPrivateView).modelRoot
    const neutralRoot = root?.getObjectByName(NEUTRAL_NODE_NAME) ?? null
    const openRoot = root?.getObjectByName(OPEN_NODE_NAME) ?? null

    if (!neutralRoot || !openRoot) {
      states.delete(this)
      return
    }

    neutralRoot.visible = true
    openRoot.visible = false
    states.set(this, { neutralRoot, openRoot, openActive: false })
  }

  prototype.applyExpression = function applyExpressionWithDualTopology(
    expression: DragonExpressionState,
  ): void {
    const state = states.get(this)
    if (!state) {
      originalApplyExpression.call(this, expression)
      return
    }

    const resolved = resolveDualTopologyJaw(expression.jawOpen, state.openActive)
    state.openActive = resolved.openActive
    state.neutralRoot.visible = !resolved.openActive
    state.openRoot.visible = resolved.openActive

    originalApplyExpression.call(this, {
      ...expression,
      jawOpen: resolved.morphJaw,
    })
  }
}

installDualTopologyRuntime()
