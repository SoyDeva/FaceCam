import {
  Box3,
  BufferAttribute,
  DynamicDrawUsage,
  Matrix4,
  Mesh,
  Object3D,
  Vector3,
} from 'three'

export interface DragonMeshEyelidBinding {
  position: BufferAttribute
  basePositions: Float32Array
  leftDeltas: Float32Array
  rightDeltas: Float32Array
  lastLeft: number
  lastRight: number
}

interface EyeRegion {
  x: number
  y: number
  radiusX: number
  radiusY: number
  side: 'left' | 'right'
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1
  const normalized = clamp((value - edge0) / (edge1 - edge0))
  return normalized * normalized * (3 - 2 * normalized)
}

export function resolveDragonMeshBlink(blink: number): number {
  const normalized = clamp((blink - 0.09) / 0.43)
  if (normalized >= 0.995) return 1
  return Math.pow(normalized, 0.66)
}

export function resolveDragonEyelidVertexWeight(
  x: number,
  y: number,
  z: number,
  eye: EyeRegion,
  frontStart: number,
  frontEnd: number,
  centerGuard: number,
): number {
  if (eye.side === 'left' && x > -centerGuard) return 0
  if (eye.side === 'right' && x < centerGuard) return 0

  const normalizedX = Math.abs(x - eye.x) / Math.max(0.000001, eye.radiusX)
  const normalizedY = Math.abs(y - eye.y) / Math.max(0.000001, eye.radiusY)
  const ellipticalDistance = Math.sqrt(
    normalizedX * normalizedX + normalizedY * normalizedY,
  )
  const radialWeight = 1 - smoothstep(0.68, 1.12, ellipticalDistance)
  const frontWeight = smoothstep(frontStart, frontEnd, z)
  return clamp(radialWeight * frontWeight)
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
}

function isDetachedEyeSurface(mesh: Mesh): boolean {
  const label = normalizedObjectLabel(mesh)
  const explicitlyEyelid = /eye\s*lid|eyelid|lid|head|face|skin/.test(label)
  const detachedEye = /iris|pupil|cornea|eyeball|eye\s*ball|lens/.test(label)
  return detachedEye && !explicitlyEyelid
}

function writeWeightedClosureDelta(
  localPosition: Vector3,
  worldPosition: Vector3,
  inverseWorld: Matrix4,
  eye: EyeRegion,
  weight: number,
  modelSize: Vector3,
  output: Float32Array,
  offset: number,
): void {
  if (weight <= 0) return

  const direction = worldPosition.y >= eye.y ? 1 : -1
  const closureLine = eye.y - modelSize.y * 0.004
  const closedSlit = modelSize.y * 0.0025
  const horizontalDistance = Math.min(
    1,
    Math.abs(worldPosition.x - eye.x) / Math.max(0.000001, eye.radiusX),
  )

  const targetWorld = worldPosition.clone()
  targetWorld.y = closureLine + direction * closedSlit
  targetWorld.z += modelSize.z * 0.012 * (1 - horizontalDistance)

  const targetLocal = targetWorld.applyMatrix4(inverseWorld)
  output[offset] = (targetLocal.x - localPosition.x) * weight
  output[offset + 1] = (targetLocal.y - localPosition.y) * weight
  output[offset + 2] = (targetLocal.z - localPosition.z) * weight
}

export function createDragonMeshEyelidRig(
  root: Object3D,
  bounds: Box3,
  size: Vector3,
  center: Vector3,
  modelEyeY: number,
): DragonMeshEyelidBinding[] {
  const eyeY = bounds.min.y + size.y * 0.575 - modelEyeY
  const leftEye: EyeRegion = {
    x: -size.x * 0.17,
    y: eyeY,
    radiusX: size.x * 0.145,
    radiusY: size.y * 0.105,
    side: 'left',
  }
  const rightEye: EyeRegion = {
    x: size.x * 0.17,
    y: eyeY,
    radiusX: size.x * 0.145,
    radiusY: size.y * 0.105,
    side: 'right',
  }
  const frontStart = -size.z * 0.05
  const frontEnd = bounds.max.z - center.z
  const centerGuard = size.x * 0.028
  const bindings: DragonMeshEyelidBinding[] = []

  root.updateMatrixWorld(true)
  root.traverse((object) => {
    if (!(object instanceof Mesh) || isDetachedEyeSurface(object)) return

    const geometry = object.geometry.clone()
    const position = geometry.getAttribute('position')
    if (!(position instanceof BufferAttribute) || position.itemSize < 3) {
      geometry.dispose()
      return
    }

    const vertexCount = position.count
    const basePositions = new Float32Array(vertexCount * 3)
    const leftDeltas = new Float32Array(vertexCount * 3)
    const rightDeltas = new Float32Array(vertexCount * 3)
    const inverseWorld = object.matrixWorld.clone().invert()
    const localPosition = new Vector3()
    const worldPosition = new Vector3()
    let affectedVertices = 0

    for (let index = 0; index < vertexCount; index += 1) {
      const offset = index * 3
      localPosition.fromBufferAttribute(position, index)
      basePositions[offset] = localPosition.x
      basePositions[offset + 1] = localPosition.y
      basePositions[offset + 2] = localPosition.z
      worldPosition.copy(localPosition).applyMatrix4(object.matrixWorld)

      const leftWeight = resolveDragonEyelidVertexWeight(
        worldPosition.x,
        worldPosition.y,
        worldPosition.z,
        leftEye,
        frontStart,
        frontEnd,
        centerGuard,
      )
      const rightWeight = resolveDragonEyelidVertexWeight(
        worldPosition.x,
        worldPosition.y,
        worldPosition.z,
        rightEye,
        frontStart,
        frontEnd,
        centerGuard,
      )

      if (leftWeight > 0.001) {
        writeWeightedClosureDelta(
          localPosition,
          worldPosition,
          inverseWorld,
          leftEye,
          leftWeight,
          size,
          leftDeltas,
          offset,
        )
        affectedVertices += 1
      }
      if (rightWeight > 0.001) {
        writeWeightedClosureDelta(
          localPosition,
          worldPosition,
          inverseWorld,
          rightEye,
          rightWeight,
          size,
          rightDeltas,
          offset,
        )
        affectedVertices += 1
      }
    }

    if (affectedVertices === 0) {
      geometry.dispose()
      return
    }

    object.geometry = geometry
    position.setUsage(DynamicDrawUsage)
    bindings.push({
      position,
      basePositions,
      leftDeltas,
      rightDeltas,
      lastLeft: -1,
      lastRight: -1,
    })
  })

  return bindings
}

export function applyDragonMeshEyelidRig(
  bindings: DragonMeshEyelidBinding[],
  blinkLeft: number,
  blinkRight: number,
): void {
  const left = resolveDragonMeshBlink(blinkLeft)
  const right = resolveDragonMeshBlink(blinkRight)

  for (const binding of bindings) {
    if (
      Math.abs(left - binding.lastLeft) <= 0.004
      && Math.abs(right - binding.lastRight) <= 0.004
    ) {
      continue
    }

    const vertexCount = binding.position.count
    for (let index = 0; index < vertexCount; index += 1) {
      const offset = index * 3
      binding.position.setXYZ(
        index,
        binding.basePositions[offset]
          + binding.leftDeltas[offset] * left
          + binding.rightDeltas[offset] * right,
        binding.basePositions[offset + 1]
          + binding.leftDeltas[offset + 1] * left
          + binding.rightDeltas[offset + 1] * right,
        binding.basePositions[offset + 2]
          + binding.leftDeltas[offset + 2] * left
          + binding.rightDeltas[offset + 2] * right,
      )
    }
    binding.position.needsUpdate = true
    binding.lastLeft = left
    binding.lastRight = right
  }
}
