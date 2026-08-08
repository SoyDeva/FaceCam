import type { Object3D } from 'three'
import type { DragonExpressionState } from './dragonExpressions'
import { StaticDragonRenderer } from './StaticDragonRenderer'

const HEAD_NODE_NAME = 'FaceCamHeadStatic'
const NEUTRAL_MOUTH_NODE_NAME = 'FaceCamNeutralMouth'
const OPEN_MOUTH_NODE_NAME = 'FaceCamOpenMouth'

// v20 keeps the authored v19 source-mouth behavior, but the GLB now places a
// four-ring neutral seam collar permanently in the static head. That collar
// backs the lateral cheek/comissure attachment while the original open-mouth
// topology is visible, so profile views do not expose black holes. Runtime must
// not transform either source mesh: all seam work is authored into the GLB.
export const DUAL_TOPOLOGY_ENTER_JAW = 0.14
export const DUAL_TOPOLOGY_EXIT_JAW = 0.055
export const DUAL_TOPOLOGY_OPEN_MORPH_START = 0.32

interface SourceMouthState {
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

const states = new WeakMap<StaticDragonRenderer, SourceMouthState>()
const patchMarker = Symbol.for('facecam.sourceMouthRuntime.v20')
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

  // The open topology has an intentionally non-neutral base. Never expose its
  // artificial rest state. Enter directly on the authored opening trajectory,
  // then map the remaining live range smoothly to the exact original full-open
  // endpoint at jawOpen=1.
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

    if (!headRoot || !neutralMouthRoot || !openMouthRoot) {
      states.delete(this)
      return
    }

    neutralMouthRoot.position.set(0, 0, 0)
    neutralMouthRoot.rotation.set(0, 0, 0)
    neutralMouthRoot.scale.set(1, 1, 1)
    openMouthRoot.position.set(0, 0, 0)
    openMouthRoot.rotation.set(0, 0, 0)
    openMouthRoot.scale.set(1, 1, 1)

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

    // HeadRoot already contains the permanent neutral seam collar in v20.
    // Only the central neutral mouth swaps with the authored open source.
    state.headRoot.visible = true
    state.neutralMouthRoot.visible = !resolved.openActive
    state.openMouthRoot.visible = resolved.openActive

    originalApplyExpression.call(this, {
      ...expression,
      jawOpen: resolved.morphJaw,
    })
  }
}

installSourceMouthRuntime()
