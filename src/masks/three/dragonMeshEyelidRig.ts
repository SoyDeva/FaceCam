import { Mesh, type Box3, type Object3D, type Vector3 } from 'three'

const BLINK_TRAVEL = 4.5
const BLINK_DEAD_ZONE = 0.035

const LEFT_BLINK_ALIASES = ['eyeBlinkLeft', 'blinkLeft'] as const
const RIGHT_BLINK_ALIASES = ['eyeBlinkRight', 'blinkRight'] as const

/**
 * A binding points only to morph-target influence slots already authored in
 * the GLB. It never creates geometry and never edits POSITION attributes.
 */
export interface DragonMeshEyelidBinding {
  influences: number[]
  leftIndex?: number
  rightIndex?: number
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
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

/**
 * The inspected White Dragon v3 GLB closes its real eyelids near influence
 * 4.5. The authored morph deltas are intentionally small, so values limited
 * to 1 or 2 only produce a partial squint.
 */
export function resolveNativeDragonBlinkInfluence(blink: number): number {
  const safeBlink = clamp(blink)
  if (safeBlink <= BLINK_DEAD_ZONE) return 0

  const normalized = clamp(
    (safeBlink - BLINK_DEAD_ZONE) / (1 - BLINK_DEAD_ZONE),
  )
  const eased = normalized * normalized * (3 - 2 * normalized)
  return Math.pow(eased, 0.78) * BLINK_TRAVEL
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

    bindings.push({ influences, leftIndex, rightIndex })
  })

  return bindings
}

export function applyDragonMeshEyelidRig(
  bindings: DragonMeshEyelidBinding[],
  blinkLeft: number,
  blinkRight: number,
): void {
  const leftInfluence = resolveNativeDragonBlinkInfluence(blinkLeft)
  const rightInfluence = resolveNativeDragonBlinkInfluence(blinkRight)

  for (const binding of bindings) {
    if (binding.leftIndex !== undefined) {
      binding.influences[binding.leftIndex] = leftInfluence
    }
    if (binding.rightIndex !== undefined) {
      binding.influences[binding.rightIndex] = rightInfluence
    }
  }
}
