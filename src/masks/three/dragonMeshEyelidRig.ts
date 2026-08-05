import {
  Box3,
  Color,
  DoubleSide,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three'

export interface DragonMeshEyelidBinding {
  group: Group
  upper: Mesh
  lower: Mesh
  seam: Mesh
  radiusX: number
  radiusY: number
  lastBlink: number
}

export interface DragonEyelidCoverPose {
  closure: number
  visible: boolean
  upperOffset: number
  lowerOffset: number
  lidScaleY: number
  seamOpacity: number
}

interface EyeAnchor {
  x: number
  y: number
  z: number
  radiusX: number
  radiusY: number
  side: 'left' | 'right'
}

interface EyeAccumulator {
  count: number
  min: Vector3
  max: Vector3
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

export function resolveDragonMeshBlink(blink: number): number {
  const normalized = clamp((blink - 0.09) / 0.43)
  if (normalized >= 0.995) return 1
  return Math.pow(normalized, 0.66)
}

export function resolveDragonEyelidCoverPose(
  blink: number,
  radiusY: number,
): DragonEyelidCoverPose {
  const closure = resolveDragonMeshBlink(blink)
  const edgeOffset = radiusY * (1 - closure) * 0.94

  return {
    closure,
    visible: closure > 0.025,
    upperOffset: edgeOffset,
    lowerOffset: -edgeOffset,
    lidScaleY: radiusY * Math.max(0.02, closure),
    seamOpacity: clamp((closure - 0.68) / 0.32) * 0.58,
  }
}

function normalizedObjectLabel(mesh: Mesh): string {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  return [
    mesh.name,
    mesh.geometry.name,
    ...materials.map((material) => material.name),
  ]
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function isLikelyEyeSurface(mesh: Mesh): boolean {
  const label = normalizedObjectLabel(mesh)
  if (/eye\s*lid|eyelid|\blid\b|\bbrow\b/.test(label)) return false
  return /\beye\b|iris|pupil|cornea|eyeball|eye\s*ball|lens/.test(label)
}

function isUnsafeFallbackSurface(mesh: Mesh): boolean {
  const label = normalizedObjectLabel(mesh)
  return /nose|nostril|snout|muzzle|jaw|mouth|tooth|teeth|tongue|horn/.test(label)
}

function createAccumulator(): EyeAccumulator {
  return {
    count: 0,
    min: new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY),
    max: new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY),
  }
}

function includePoint(accumulator: EyeAccumulator, point: Vector3): void {
  accumulator.count += 1
  accumulator.min.min(point)
  accumulator.max.max(point)
}

function collectEyeSurfaceBounds(root: Object3D): {
  left: EyeAccumulator
  right: EyeAccumulator
} {
  const left = createAccumulator()
  const right = createAccumulator()
  const local = new Vector3()
  const world = new Vector3()

  root.traverse((object) => {
    if (!(object instanceof Mesh) || !isLikelyEyeSurface(object)) return
    const position = object.geometry.getAttribute('position')
    if (!position || position.itemSize < 3) return

    for (let index = 0; index < position.count; index += 1) {
      local.set(position.getX(index), position.getY(index), position.getZ(index))
      world.copy(local).applyMatrix4(object.matrixWorld)
      if (world.x < 0) includePoint(left, world)
      if (world.x > 0) includePoint(right, world)
    }
  })

  return { left, right }
}

function anchorFromAccumulator(
  accumulator: EyeAccumulator,
  side: 'left' | 'right',
  size: Vector3,
): EyeAnchor | null {
  if (accumulator.count < 8) return null

  const width = accumulator.max.x - accumulator.min.x
  const height = accumulator.max.y - accumulator.min.y
  const depth = accumulator.max.z - accumulator.min.z
  if (
    width <= 0
    || height <= 0
    || width > size.x * 0.34
    || height > size.y * 0.24
    || depth > size.z * 0.4
  ) {
    return null
  }

  return {
    x: (accumulator.min.x + accumulator.max.x) * 0.5,
    y: (accumulator.min.y + accumulator.max.y) * 0.5,
    z: accumulator.max.z + size.z * 0.004,
    radiusX: clamp(width * 0.66, size.x * 0.052, size.x * 0.115),
    radiusY: clamp(height * 0.72, size.y * 0.034, size.y * 0.078),
    side,
  }
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null
  values.sort((left, right) => left - right)
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * ratio)))
  return values[index]
}

function resolveFallbackFront(
  root: Object3D,
  anchorX: number,
  anchorY: number,
  size: Vector3,
  fallbackZ: number,
): number {
  const zValues: number[] = []
  const local = new Vector3()
  const world = new Vector3()

  root.traverse((object) => {
    if (!(object instanceof Mesh) || isUnsafeFallbackSurface(object)) return
    const position = object.geometry.getAttribute('position')
    if (!position || position.itemSize < 3) return

    for (let index = 0; index < position.count; index += 1) {
      local.set(position.getX(index), position.getY(index), position.getZ(index))
      world.copy(local).applyMatrix4(object.matrixWorld)
      if (
        Math.abs(world.x - anchorX) <= size.x * 0.12
        && Math.abs(world.y - anchorY) <= size.y * 0.085
      ) {
        zValues.push(world.z)
      }
    }
  })

  return (percentile(zValues, 0.9) ?? fallbackZ) + size.z * 0.004
}

function resolveEyelidColor(root: Object3D): Color {
  let bestVertexCount = -1
  let selected = new Color(0xdce8ec)

  root.traverse((object) => {
    if (!(object instanceof Mesh) || isLikelyEyeSurface(object)) return
    const label = normalizedObjectLabel(object)
    if (/mouth|tooth|teeth|tongue|horn|aura/.test(label)) return

    const position = object.geometry.getAttribute('position')
    const vertexCount = position?.count ?? 0
    if (vertexCount <= bestVertexCount) return

    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      const candidate = material as Material & { color?: Color }
      if (candidate.color?.isColor) {
        selected = candidate.color.clone()
        bestVertexCount = vertexCount
        break
      }
    }
  })

  return selected.lerp(new Color(0xffffff), 0.08)
}

function createUpperLidShape(): Shape {
  const shape = new Shape()
  shape.moveTo(-1.08, 0)
  shape.bezierCurveTo(-0.62, 0.08, 0.62, 0.08, 1.08, 0)
  shape.bezierCurveTo(0.9, 0.78, 0.48, 1.02, 0, 1.04)
  shape.bezierCurveTo(-0.48, 1.02, -0.9, 0.78, -1.08, 0)
  shape.closePath()
  return shape
}

function createLowerLidShape(): Shape {
  const shape = new Shape()
  shape.moveTo(-1.08, 0)
  shape.bezierCurveTo(-0.62, -0.08, 0.62, -0.08, 1.08, 0)
  shape.bezierCurveTo(0.9, -0.78, 0.48, -1.02, 0, -1.04)
  shape.bezierCurveTo(-0.48, -1.02, -0.9, -0.78, -1.08, 0)
  shape.closePath()
  return shape
}

function createSeamShape(): Shape {
  const shape = new Shape()
  shape.moveTo(-1.04, 0)
  shape.bezierCurveTo(-0.58, 0.045, 0.58, 0.045, 1.04, 0)
  shape.bezierCurveTo(0.58, -0.045, -0.58, -0.045, -1.04, 0)
  shape.closePath()
  return shape
}

function createBinding(
  root: Object3D,
  anchor: EyeAnchor,
  eyelidColor: Color,
  size: Vector3,
): DragonMeshEyelidBinding {
  const group = new Group()
  group.name = `WhiteDragon_${anchor.side}_AnatomicalEyelid`
  group.position.copy(root.worldToLocal(new Vector3(anchor.x, anchor.y, anchor.z)))

  const lidMaterial = new MeshStandardMaterial({
    color: eyelidColor,
    roughness: 0.78,
    metalness: 0.025,
    emissive: eyelidColor.clone().multiplyScalar(0.035),
    emissiveIntensity: 0.35,
    side: DoubleSide,
    depthTest: true,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const seamMaterial = new MeshBasicMaterial({
    color: eyelidColor.clone().multiplyScalar(0.38),
    transparent: true,
    opacity: 0,
    side: DoubleSide,
    depthTest: true,
    depthWrite: false,
  })

  const upper = new Mesh(new ShapeGeometry(createUpperLidShape(), 18), lidMaterial)
  const lower = new Mesh(new ShapeGeometry(createLowerLidShape(), 18), lidMaterial.clone())
  const seam = new Mesh(new ShapeGeometry(createSeamShape(), 18), seamMaterial)

  upper.name = `${group.name}_Upper`
  lower.name = `${group.name}_Lower`
  seam.name = `${group.name}_Seam`
  upper.frustumCulled = false
  lower.frustumCulled = false
  seam.frustumCulled = false
  upper.renderOrder = 25
  lower.renderOrder = 25
  seam.renderOrder = 26
  upper.position.z = size.z * 0.001
  lower.position.z = size.z * 0.0012
  seam.position.z = size.z * 0.0018

  group.add(upper, lower, seam)
  root.add(group)

  return {
    group,
    upper,
    lower,
    seam,
    radiusX: anchor.radiusX,
    radiusY: anchor.radiusY,
    lastBlink: Number.NaN,
  }
}

export function createDragonMeshEyelidRig(
  root: Object3D,
  bounds: Box3,
  size: Vector3,
  center: Vector3,
  modelEyeY: number,
): DragonMeshEyelidBinding[] {
  root.updateMatrixWorld(true)

  const eyeY = bounds.min.y + size.y * 0.575 - modelEyeY
  const fallbackFront = bounds.max.z - center.z - size.z * 0.035
  const detected = collectEyeSurfaceBounds(root)

  const fallbackLeftX = -size.x * 0.17
  const fallbackRightX = size.x * 0.17
  const left = anchorFromAccumulator(detected.left, 'left', size) ?? {
    x: fallbackLeftX,
    y: eyeY,
    z: resolveFallbackFront(root, fallbackLeftX, eyeY, size, fallbackFront),
    radiusX: size.x * 0.098,
    radiusY: size.y * 0.058,
    side: 'left' as const,
  }
  const right = anchorFromAccumulator(detected.right, 'right', size) ?? {
    x: fallbackRightX,
    y: eyeY,
    z: resolveFallbackFront(root, fallbackRightX, eyeY, size, fallbackFront),
    radiusX: size.x * 0.098,
    radiusY: size.y * 0.058,
    side: 'right' as const,
  }

  const eyelidColor = resolveEyelidColor(root)
  const bindings = [
    createBinding(root, left, eyelidColor, size),
    createBinding(root, right, eyelidColor, size),
  ]

  applyDragonMeshEyelidRig(bindings, 0, 0)
  return bindings
}

function applyBinding(binding: DragonMeshEyelidBinding, blink: number): void {
  const pose = resolveDragonEyelidCoverPose(blink, binding.radiusY)
  if (Number.isFinite(binding.lastBlink) && Math.abs(pose.closure - binding.lastBlink) <= 0.004) {
    return
  }

  binding.upper.visible = pose.visible
  binding.lower.visible = pose.visible
  binding.seam.visible = pose.seamOpacity > 0.01

  binding.upper.position.y = pose.upperOffset
  binding.lower.position.y = pose.lowerOffset
  binding.upper.scale.set(binding.radiusX, pose.lidScaleY, 1)
  binding.lower.scale.set(binding.radiusX, pose.lidScaleY, 1)
  binding.seam.scale.set(binding.radiusX, binding.radiusY, 1)

  const seamMaterial = binding.seam.material as MeshBasicMaterial
  seamMaterial.opacity = pose.seamOpacity
  binding.lastBlink = pose.closure
}

export function applyDragonMeshEyelidRig(
  bindings: DragonMeshEyelidBinding[],
  blinkLeft: number,
  blinkRight: number,
): void {
  if (bindings[0]) applyBinding(bindings[0], blinkLeft)
  if (bindings[1]) applyBinding(bindings[1], blinkRight)
}
