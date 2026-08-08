import type { Object3D } from 'three'
import type { DragonExpressionState } from './dragonExpressions'
import { StaticDragonRenderer } from './StaticDragonRenderer'

const SINGLE_SOURCE_NODE_NAME = 'FaceCamSingleSourceDragon'

// v27 uses one and only one visible topology: the complete authoritative
// Abierto_Dragon.glb source. Its jawOpen-named morph is intentionally a
// neutral-close target: weight 1 is the sculpted neutral mouth and weight 0 is
// the exact authored open source. Runtime therefore converts live jaw opening
// into the inverse morph weight. There is no topology switch, seam, collar or
// bridge anywhere in the mouth path.
export const SINGLE_SOURCE_JAW_DEADZONE = 0.025
export const SINGLE_SOURCE_JAW_FULL = 0.68

// StaticDragonRenderer currently applies a 1.22 response gain to its jawOpen
// semantic. Compensate here so the actual morph influence remains exactly the
// closeWeight resolved below. This does not affect blink/gaze/tracking values.
export const SINGLE_SOURCE_RENDERER_JAW_GAIN = 1.22

interface RendererPrototype {
  load(this: StaticDragonRenderer, file: Blob): Promise<void>
  applyExpression(this: StaticDragonRenderer, expression: DragonExpressionState): void
}

interface RendererPrivateView {
  modelRoot: Object3D | null
}

const activeRenderers = new WeakSet<StaticDragonRenderer>()
const patchMarker = Symbol.for('facecam.singleSourceRuntime.v27')
const prototype = StaticDragonRenderer.prototype as unknown as RendererPrototype & Record<PropertyKey, unknown>

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function resolveSingleSourceJaw(
  jawOpen: number,
): { openAmount: number; closeWeight: number; rendererJawValue: number } {
  const jaw = clamp01(jawOpen)
  const normalized = clamp01(
    (jaw - SINGLE_SOURCE_JAW_DEADZONE)
      / (SINGLE_SOURCE_JAW_FULL - SINGLE_SOURCE_JAW_DEADZONE),
  )
  const openAmount = normalized * normalized * (3 - 2 * normalized)
  const closeWeight = 1 - openAmount

  return {
    openAmount,
    closeWeight,
    rendererJawValue: closeWeight / SINGLE_SOURCE_RENDERER_JAW_GAIN,
  }
}

function neutralExpression(): DragonExpressionState {
  return {
    jawOpen: 1 / SINGLE_SOURCE_RENDERER_JAW_GAIN,
    blinkLeft: 0,
    blinkRight: 0,
    gazeX: 0,
    gazeY: 0,
    smile: 0,
    browRaise: 0,
  }
}

function installSingleSourceRuntime(): void {
  if (prototype[patchMarker]) return
  prototype[patchMarker] = true

  const originalLoad = prototype.load
  const originalApplyExpression = prototype.applyExpression

  prototype.load = async function loadSingleSource(file: Blob): Promise<void> {
    activeRenderers.delete(this)
    await originalLoad.call(this, file)

    const root = (this as unknown as RendererPrivateView).modelRoot
    const sourceRoot = root?.getObjectByName(SINGLE_SOURCE_NODE_NAME) ?? null
    if (!sourceRoot) return

    // The authoritative source has no authored node transform. Keeping the
    // runtime transform explicit also prevents stale transforms from older
    // multi-node rigs from leaking into a locally replaced GLB.
    sourceRoot.position.set(0, 0, 0)
    sourceRoot.rotation.set(0, 0, 0)
    sourceRoot.scale.set(1, 1, 1)
    sourceRoot.visible = true

    activeRenderers.add(this)
    // originalLoad briefly applies jawOpen=0 before the v27 node is identified;
    // force the single source into its neutral-close pose immediately afterward.
    originalApplyExpression.call(this, neutralExpression())
  }

  prototype.applyExpression = function applyExpressionSingleSource(
    expression: DragonExpressionState,
  ): void {
    if (!activeRenderers.has(this)) {
      originalApplyExpression.call(this, expression)
      return
    }

    const resolved = resolveSingleSourceJaw(expression.jawOpen)
    originalApplyExpression.call(this, {
      ...expression,
      // Only the mouth semantic is inverted. Both blink values pass through
      // byte-for-byte so the approved live eye estimator remains untouched.
      jawOpen: resolved.rendererJawValue,
    })
  }
}

installSingleSourceRuntime()
