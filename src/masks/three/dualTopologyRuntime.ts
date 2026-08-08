import type { Object3D } from 'three'
import type { DragonExpressionState } from './dragonExpressions'
import { StaticDragonRenderer } from './StaticDragonRenderer'

const NEUTRAL_HEAD_NODE_NAME = 'FaceCamNeutralHead'
const NEUTRAL_MOUTH_NODE_NAME = 'FaceCamNeutralMouth'
const OPEN_FULL_NODE_NAME = 'FaceCamOpenFullSource'

// v26 removes the regional mouth splice entirely. Closed state is the approved
// v20 neutral head + neutral mouth. Once a real opening begins, both neutral
// pieces hide and the complete authored Abierto_Dragon topology becomes the
// only visible dragon. The open full-source mesh carries jawOpen plus transferred
// eyeBlinkLeft/eyeBlinkRight morphs, so blinking remains native in both states
// without ever overlapping two different upper muzzles.
export const DUAL_TOPOLOGY_ENTER_JAW = 0.14
export const DUAL_TOPOLOGY_EXIT_JAW = 0.055
export const DUAL_TOPOLOGY_OPEN_MORPH_START = 0.32

interface DualSourceState {
  neutralHeadRoot: Object3D
  neutralMouthRoot: Object3D
  openFullRoot: Object3D
  openActive: boolean
}

interface RendererPrototype {
  load(this: StaticDragonRenderer, file: Blob): Promise<void>
  applyExpression(this: StaticDragonRenderer, expression: DragonExpressionState): void
}

interface RendererPrivateView {
  modelRoot: Object3D | null
}

const states = new WeakMap<StaticDragonRenderer, DualSourceState>()
const patchMarker = Symbol.for('facecam.fullSourceRuntime.v26')
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

function installFullSourceRuntime(): void {
  if (prototype[patchMarker]) return
  prototype[patchMarker] = true

  const originalLoad = prototype.load
  const originalApplyExpression = prototype.applyExpression

  prototype.load = async function loadWithFullSource(file: Blob): Promise<void> {
    await originalLoad.call(this, file)

    const root = (this as unknown as RendererPrivateView).modelRoot
    const neutralHeadRoot = root?.getObjectByName(NEUTRAL_HEAD_NODE_NAME) ?? null
    const neutralMouthRoot = root?.getObjectByName(NEUTRAL_MOUTH_NODE_NAME) ?? null
    const openFullRoot = root?.getObjectByName(OPEN_FULL_NODE_NAME) ?? null

    if (!neutralHeadRoot || !neutralMouthRoot || !openFullRoot) {
      states.delete(this)
      return
    }

    for (const rootPart of [neutralHeadRoot, neutralMouthRoot, openFullRoot]) {
      rootPart.position.set(0, 0, 0)
      rootPart.rotation.set(0, 0, 0)
      rootPart.scale.set(1, 1, 1)
    }

    neutralHeadRoot.visible = true
    neutralMouthRoot.visible = true
    openFullRoot.visible = false
    states.set(this, {
      neutralHeadRoot,
      neutralMouthRoot,
      openFullRoot,
      openActive: false,
    })
  }

  prototype.applyExpression = function applyExpressionWithFullSource(
    expression: DragonExpressionState,
  ): void {
    const state = states.get(this)
    if (!state) {
      originalApplyExpression.call(this, expression)
      return
    }

    const resolved = resolveDualTopologyJaw(expression.jawOpen, state.openActive)
    state.openActive = resolved.openActive

    // Never render neutral and open upper skulls together. This is the central
    // v26 invariant that removes every mouth seam/shelf from v21-v25.
    state.neutralHeadRoot.visible = !resolved.openActive
    state.neutralMouthRoot.visible = !resolved.openActive
    state.openFullRoot.visible = resolved.openActive

    // The open full-source mesh has jawOpen + both blink morphs. The existing
    // renderer therefore drives the same expression state on whichever complete
    // topology is currently visible.
    originalApplyExpression.call(this, {
      ...expression,
      jawOpen: resolved.morphJaw,
    })
  }
}

installFullSourceRuntime()
