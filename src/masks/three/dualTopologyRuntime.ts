import type { Object3D } from 'three'
import type { DragonExpressionState } from './dragonExpressions'
import { StaticDragonRenderer } from './StaticDragonRenderer'

const HEAD_NODE_NAME = 'FaceCamHeadStatic'
const NEUTRAL_MOUTH_NODE_NAME = 'FaceCamNeutralMouth'
const OPEN_MOUTH_NODE_NAME = 'FaceCamOpenMouth'
const UPPER_MUZZLE_NODE_NAME = 'FaceCamNeutralUpperMuzzle'

// v24 stops splicing authored open upper skin into the neutral skull. The
// approved neutral upper hocico stays visible and continuous at every jaw value.
// Only the closed lower-mouth patch swaps with the authored Abierto_Dragon
// lower/interior source. The GLB removes the 593-triangle open upper exterior
// component that conflicted with the neutral hocico; eyes/tracking are unchanged.
export const DUAL_TOPOLOGY_ENTER_JAW = 0.14
export const DUAL_TOPOLOGY_EXIT_JAW = 0.055
export const DUAL_TOPOLOGY_OPEN_MORPH_START = 0.32

interface SourceMouthState {
  headRoot: Object3D
  neutralMouthRoot: Object3D
  openMouthRoot: Object3D
  upperMuzzleRoot: Object3D
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
const patchMarker = Symbol.for('facecam.sourceMouthRuntime.v24')
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
    const upperMuzzleRoot = root?.getObjectByName(UPPER_MUZZLE_NODE_NAME) ?? null

    if (!headRoot || !neutralMouthRoot || !openMouthRoot || !upperMuzzleRoot) {
      states.delete(this)
      return
    }

    for (const rootPart of [neutralMouthRoot, openMouthRoot, upperMuzzleRoot]) {
      rootPart.position.set(0, 0, 0)
      rootPart.rotation.set(0, 0, 0)
      rootPart.scale.set(1, 1, 1)
    }

    headRoot.visible = true
    upperMuzzleRoot.visible = true
    neutralMouthRoot.visible = true
    openMouthRoot.visible = false
    states.set(this, {
      headRoot,
      neutralMouthRoot,
      openMouthRoot,
      upperMuzzleRoot,
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

    // The upper skull/hocico never switches topology in v24.
    state.headRoot.visible = true
    state.upperMuzzleRoot.visible = true
    state.neutralMouthRoot.visible = !resolved.openActive
    state.openMouthRoot.visible = resolved.openActive

    originalApplyExpression.call(this, {
      ...expression,
      jawOpen: resolved.morphJaw,
    })
  }
}

installSourceMouthRuntime()
