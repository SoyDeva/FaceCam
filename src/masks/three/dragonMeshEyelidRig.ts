import {
  BufferAttribute,
  Float32BufferAttribute,
  Mesh,
  Vector3,
  type Box3,
  type Object3D,
} from 'three'

const BLINK_DEAD_ZONE = 0.035

const LEFT_BLINK_ALIASES = ['eyeBlinkLeft', 'blinkLeft'] as const
const RIGHT_BLINK_ALIASES = ['eyeBlinkRight', 'blinkRight'] as const

// Measurements taken directly from FaceCam-Dragon-Blanco-Rigged-CORRECTO-v3.glb.
// The old eyeBlink targets start above the blue irises and therefore animate
// the brow crests. These normalized coordinates isolate the actual blue eye
// surfaces and the immediately surrounding socket, while hard-excluding the
// brow, nose, muzzle and cheeks.
const EYE_CENTER_X_RATIO = 0.1496
const EYE_CENTER_Y_RATIO = 0.4820
const EYE_CENTER_Z_RATIO = 0.8092
const EYE_RADIUS_X_RATIO = 0.1000
const EYE_RADIUS_Y_RATIO = 0.0566
const EYE_RADIUS_Z_RATIO = 0.0868
const EYE_LOWER_LIMIT_RATIO = 0.4242
const EYE_UPPER_LIMIT_RATIO = 0.5302
const EYE_FRONT_LIMIT_RATIO = 0.7197
const CORE_RADIUS_X_RATIO = 0.0600
const CORE_RADIUS_Y_RATIO = 0.0330
const CORE_RADIUS_Z_RATIO = 0.0715
const CORE_LOWER_LIMIT_RATIO = 0.4427
const CORE_UPPER_LIMIT_RATIO = 0.5200
const CORE_FRONT_LIMIT_RATIO = 0.7500
const COLLAPSE_GAIN = 1.75
const IRIS_RECESS_RATIO = 0.0255

export type DragonEyeSide = 'left' | 'right'

/**
 * A binding points only to morph-target influence slots already authored in
 * the GLB. The corresponding bad brow targets are replaced once at load time
 * with corrected deltas over the original blue-eye geometry.
 */
export interface DragonMeshEyelidBinding {
  influences: number[]
  leftIndex?: number
  rightIndex?: number
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function smooth01(value: number): number {
  const amount = clamp(value)
  return amount * amount * (3 - 2 * amount)
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

function attributeBounds(position: BufferAttribute): Box3 {
  const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    min.x = Math.min(min.x, x)
    min.y = Math.min(min.y, y)
    min.z = Math.min(min.z, z)
    max.x = Math.max(max.x, x)
    max.y = Math.max(max.y, y)
    max.z = Math.max(max.z, z)
  }

  return { min, max } as Box3
}

/**
 * Builds a relative morph target that closes the original blue circular eye.
 * It compresses the eye surface vertically to its own centre line and recesses
 * the iris slightly into the socket. Vertices above the measured eye ceiling
 * are always zero, which prevents the eyebrow/crest movement seen previously.
 */
export function buildDragonBlueEyeBlinkDeltas(
  position: BufferAttribute,
  side: DragonEyeSide,
): Float32Array {
  const bounds = attributeBounds(position)
  const size = bounds.max.clone().sub(bounds.min)
  const center = bounds.min.clone().add(size.clone().multiplyScalar(0.5))
  const deltas = new Float32Array(position.count * 3)

  if (size.x <= 0 || size.y <= 0 || size.z <= 0) return deltas

  // glTF character-left is positive X in the inspected White Dragon v3 mesh.
  const sideSign = side === 'left' ? 1 : -1
  const centerX = center.x + size.x * EYE_CENTER_X_RATIO * sideSign
  const centerY = bounds.min.y + size.y * EYE_CENTER_Y_RATIO
  const centerZ = bounds.min.z + size.z * EYE_CENTER_Z_RATIO
  const radiusX = size.x * EYE_RADIUS_X_RATIO
  const radiusY = size.y * EYE_RADIUS_Y_RATIO
  const radiusZ = size.z * EYE_RADIUS_Z_RATIO
  const lowerLimit = bounds.min.y + size.y * EYE_LOWER_LIMIT_RATIO
  const upperLimit = bounds.min.y + size.y * EYE_UPPER_LIMIT_RATIO
  const frontLimit = bounds.min.z + size.z * EYE_FRONT_LIMIT_RATIO

  const coreRadiusX = size.x * CORE_RADIUS_X_RATIO
  const coreRadiusY = size.y * CORE_RADIUS_Y_RATIO
  const coreRadiusZ = size.z * CORE_RADIUS_Z_RATIO
  const coreLowerLimit = bounds.min.y + size.y * CORE_LOWER_LIMIT_RATIO
  const coreUpperLimit = bounds.min.y + size.y * CORE_UPPER_LIMIT_RATIO
  const coreFrontLimit = bounds.min.z + size.z * CORE_FRONT_LIMIT_RATIO

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)

    if (y < lowerLimit || y > upperLimit || z < frontLimit) continue

    const dx = x - centerX
    const dy = y - centerY
    const dz = z - centerZ
    const support = smooth01(1 - Math.abs(dx) / radiusX)
      * smooth01(1 - Math.abs(dy) / radiusY)
      * smooth01(1 - Math.abs(dz) / radiusZ)
    const collapse = clamp(support * COLLAPSE_GAIN)

    deltas[index * 3 + 1] = (centerY - y) * collapse

    if (y >= coreLowerLimit && y <= coreUpperLimit && z >= coreFrontLimit) {
      const core = smooth01(1 - Math.abs(dx) / coreRadiusX)
        * smooth01(1 - Math.abs(dy) / coreRadiusY)
        * smooth01(1 - Math.abs(dz) / coreRadiusZ)
      deltas[index * 3 + 2] = -size.z * IRIS_RECESS_RATIO * clamp(core * 1.25)
    }
  }

  return deltas
}

function replaceBlinkTarget(mesh: Mesh, index: number, side: DragonEyeSide): void {
  const position = mesh.geometry.getAttribute('position')
  if (!(position instanceof BufferAttribute)) return

  const morphPositions = mesh.geometry.morphAttributes.position
  if (!morphPositions || index < 0 || index >= morphPositions.length) return

  const corrected = new Float32BufferAttribute(
    buildDragonBlueEyeBlinkDeltas(position, side),
    3,
  )
  corrected.name = `FaceCam_${side}_BlueEyeBlink`
  morphPositions[index] = corrected

  // The original normal target belongs to the brow deformation. Zero it so
  // the old crest shading cannot reappear while the corrected eye closes.
  const morphNormals = mesh.geometry.morphAttributes.normal
  if (morphNormals && index < morphNormals.length) {
    const neutralNormals = new Float32BufferAttribute(
      new Float32Array(position.count * 3),
      3,
    )
    neutralNormals.name = `FaceCam_${side}_BlueEyeBlinkNormals`
    morphNormals[index] = neutralNormals
  }

  mesh.geometry.morphTargetsRelative = true
}

export function resolveNativeDragonBlinkInfluence(blink: number): number {
  const safeBlink = clamp(blink)
  if (safeBlink <= BLINK_DEAD_ZONE) return 0

  const normalized = clamp(
    (safeBlink - BLINK_DEAD_ZONE) / (1 - BLINK_DEAD_ZONE),
  )
  const eased = normalized * normalized * (3 - 2 * normalized)
  return Math.pow(eased, 0.72)
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

    if (leftIndex !== undefined) replaceBlinkTarget(object, leftIndex, 'left')
    if (rightIndex !== undefined) replaceBlinkTarget(object, rightIndex, 'right')

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
