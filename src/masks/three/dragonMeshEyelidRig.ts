import { Mesh, type Box3, type Object3D, type Vector3 } from 'three'

const BLINK_DEAD_ZONE = 0.02
const LEFT_BLINK_ALIASES = ['eyeBlinkLeft', 'blinkLeft'] as const
const RIGHT_BLINK_ALIASES = ['eyeBlinkRight', 'blinkRight'] as const
const V6_RIG_VERSION = '6.0.0'

/**
 * Each binding points only to morph-target influence slots authored inside
 * the installed GLB. FaceCam never creates replacement eyelids and never
 * rewrites POSITION or NORMAL attributes at runtime.
 */
export interface DragonMeshEyelidBinding {
  influences: number[]
  leftIndex?: number
  rightIndex?: number
  selfTestEnabled: boolean
  selfTestStartedAt: number | null
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0))
  return amount * amount * (3 - 2 * amount)
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function normalizedMorphName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function resolveMorphIndex(
  dictionary: Record<string, number>,
  aliases: readonly string[],
): number | undefined {
  const normalized = new Map(
    Object.entries(dictionary).map(([name, index]) => [normalizedMorphName(name), index]),
  )

  for (const alias of aliases) {
    const index = normalized.get(normalizedMorphName(alias))
    if (index !== undefined) return index
  }
  return undefined
}

function resolveSelfTestInfluence(binding: DragonMeshEyelidBinding, now: number): number {
  if (!binding.selfTestEnabled) return 0
  if (binding.selfTestStartedAt === null) binding.selfTestStartedAt = now

  const elapsed = now - binding.selfTestStartedAt
  if (elapsed < 250) return 0
  if (elapsed < 475) return smoothstep(250, 475, elapsed)
  if (elapsed < 875) return 1
  if (elapsed < 1125) return 1 - smoothstep(875, 1125, elapsed)

  binding.selfTestEnabled = false
  return 0
}

/**
 * The v6 GLB stores complete eye closure at morph influence 1. The incoming
 * expression already contains noise rejection, so this final response curve
 * prioritizes a clearly visible closure instead of leaving natural blinks at
 * an imperceptible fraction of the authored morph travel.
 */
export function resolveNativeDragonBlinkInfluence(blink: number): number {
  const safeBlink = clamp(blink)
  if (safeBlink <= BLINK_DEAD_ZONE) return 0

  const normalized = clamp(
    (safeBlink - BLINK_DEAD_ZONE) / (1 - BLINK_DEAD_ZONE),
  )
  const eased = normalized * normalized * (3 - 2 * normalized)
  return clamp(Math.pow(eased, 0.42) * 1.12)
}

export function createDragonMeshEyelidRig(
  root: Object3D,
  _bounds: Box3,
  _size: Vector3,
  _center: Vector3,
  _modelEyeY: number,
): DragonMeshEyelidBinding[] {
  const bindings: DragonMeshEyelidBinding[] = []

  root.traverse((object) => {
    if (!(object instanceof Mesh)) return

    const dictionary = object.morphTargetDictionary
    const influences = object.morphTargetInfluences
    if (!dictionary || !influences) return

    const leftIndex = resolveMorphIndex(dictionary, LEFT_BLINK_ALIASES)
    const rightIndex = resolveMorphIndex(dictionary, RIGHT_BLINK_ALIASES)
    if (leftIndex === undefined && rightIndex === undefined) return

    const rigVersion = String(object.userData?.faceCamRigVersion ?? '')
    bindings.push({
      influences,
      leftIndex,
      rightIndex,
      selfTestEnabled: rigVersion === V6_RIG_VERSION,
      selfTestStartedAt: null,
    })
  })

  return bindings
}

export function applyDragonMeshEyelidRig(
  bindings: DragonMeshEyelidBinding[],
  blinkLeft: number,
  blinkRight: number,
): void {
  const now = nowMs()
  const liveLeft = resolveNativeDragonBlinkInfluence(blinkLeft)
  const liveRight = resolveNativeDragonBlinkInfluence(blinkRight)

  for (const binding of bindings) {
    const selfTest = resolveSelfTestInfluence(binding, now)
    const leftInfluence = Math.max(liveLeft, selfTest)
    const rightInfluence = Math.max(liveRight, selfTest)

    if (binding.leftIndex !== undefined) {
      binding.influences[binding.leftIndex] = leftInfluence
    }
    if (binding.rightIndex !== undefined) {
      binding.influences[binding.rightIndex] = rightInfluence
    }
  }
}
