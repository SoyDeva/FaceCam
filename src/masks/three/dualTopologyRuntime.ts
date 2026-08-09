import type { Object3D } from 'three'
import type { DragonExpressionState } from './dragonExpressions'
import { StaticDragonRenderer } from './StaticDragonRenderer'

const SINGLE_SOURCE_NODE_NAME = 'FaceCamSingleSourceDragon'

// v29 keeps one visible topology: the complete authoritative Abierto_Dragon.glb
// source. The jawOpen-named morph is a neutral-close target whose displacement
// was rebuilt as a smooth spatial oral field against the authoritative neutral
// reference. Nearby disconnected oral islands therefore move coherently instead
// of producing the block, dark hole and corner shards seen in v27/v28.
export const SINGLE_SOURCE_JAW_DEADZONE = 0.025
export const SINGLE_SOURCE_JAW_FULL = 0.68

// StaticDragonRenderer applies a 1.22 response gain to its jawOpen semantic.
// Compensate here so the actual morph influence remains exactly closeWeight.
// Blink/gaze/tracking values pass through unchanged.
export const SINGLE_SOURCE_RENDERER_JAW_GAIN = 1.22

interface RendererPrototype {
  load(this: StaticDragonRenderer, file: Blob): Promise<void>
  applyExpression(this: StaticDragonRenderer, expression: DragonExpressionState): void
}

interface RendererPrivateView {
  modelRoot: Object3D | null
}

const activeRenderers = new WeakSet<StaticDragonRenderer>()
const patchMarker = Symbol.for('facecam.singleSourceRuntime.v29')
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

    sourceRoot.position.set(0, 0, 0)
    sourceRoot.rotation.set(0, 0, 0)
    sourceRoot.scale.set(1, 1, 1)
    sourceRoot.visible = true

    activeRenderers.add(this)
    // originalLoad briefly applies jawOpen=0 before the v29 node is identified;
    // force the single source into the corrected neutral-close pose afterward.
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
      jawOpen: resolved.rendererJawValue,
    })
  }
}

installSingleSourceRuntime()
