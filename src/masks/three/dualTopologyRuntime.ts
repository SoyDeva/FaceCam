import { Mesh, type Object3D } from 'three'
import type { DragonExpressionState } from './dragonExpressions'
import { StaticDragonRenderer } from './StaticDragonRenderer'

const HEAD_NODE_NAME = 'FaceCamHeadStatic'
const NEUTRAL_MOUTH_NODE_NAME = 'FaceCamNeutralMouth'
const OPEN_MOUTH_NODE_NAME = 'FaceCamOpenMouth'

// v18 keeps the exact neutral exterior and rotates its lower jaw as a rigid
// object. The open-source topology is used only as hidden oral interior.
export const DUAL_TOPOLOGY_ENTER_JAW = 0.08
export const DUAL_TOPOLOGY_EXIT_JAW = 0.03
export const RIGID_JAW_HINGE_Y = 0.305
export const RIGID_JAW_HINGE_Z = 0.145
export const RIGID_JAW_MAX_ANGLE_RAD = 16 * Math.PI / 180

// These limits come from the validated v15 deep-cavity partition. v18 had
// widened that region to almost the whole lower face (4,991 triangles), which
// exposed cheek/lower-jaw fragments and lateral teeth behind the rigid jaw.
// Keep only the deep, central oral region from the authored Abierto_Dragon
// endpoint. A lower Y bound also removes chin/neck fragments that can never be
// legitimate mouth interior.
export const ORIGINAL_CAVITY_MAX_Z = 0.22
export const ORIGINAL_CAVITY_MAX_ABS_X = 0.13
export const ORIGINAL_CAVITY_MIN_Y = 0.22
export const ORIGINAL_CAVITY_MAX_Y = 0.42

interface RegionalHybridState {
  headRoot: Object3D
  neutralMouthRoot: Object3D
  openMouthRoot: Object3D
  openActive: boolean
  neutralBaseY: number
  neutralBaseZ: number
  neutralBaseRotationX: number
}

interface RendererPrototype {
  load(this: StaticDragonRenderer, file: Blob): Promise<void>
  applyExpression(this: StaticDragonRenderer, expression: DragonExpressionState): void
}

interface RendererPrivateView {
  modelRoot: Object3D | null
}

const states = new WeakMap<StaticDragonRenderer, RegionalHybridState>()
const patchMarker = Symbol.for('facecam.regionalHybridRuntime.v18')
const prototype = StaticDragonRenderer.prototype as unknown as RendererPrototype & Record<PropertyKey, unknown>

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function isOriginalOpenCavityCenter(x: number, y: number, z: number): boolean {
  return (
    z < ORIGINAL_CAVITY_MAX_Z
    && Math.abs(x) < ORIGINAL_CAVITY_MAX_ABS_X
    && y > ORIGINAL_CAVITY_MIN_Y
    && y < ORIGINAL_CAVITY_MAX_Y
  )
}

function bakeOriginalOpenEndpointInterior(root: Object3D): number {
  let keptTriangles = 0

  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return

    const geometry = mesh.geometry
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()
    const morphPosition = geometry.morphAttributes.position?.[0]
    if (!position || !index || !morphPosition) return

    const relative = geometry.morphTargetsRelative
    const endpoint = (vertexIndex: number): [number, number, number] => {
      const baseX = position.getX(vertexIndex)
      const baseY = position.getY(vertexIndex)
      const baseZ = position.getZ(vertexIndex)
      const morphX = morphPosition.getX(vertexIndex)
      const morphY = morphPosition.getY(vertexIndex)
      const morphZ = morphPosition.getZ(vertexIndex)
      return relative
        ? [baseX + morphX, baseY + morphY, baseZ + morphZ]
        : [morphX, morphY, morphZ]
    }

    const selectedIndices: number[] = []
    for (let offset = 0; offset + 2 < index.count; offset += 3) {
      const a = index.getX(offset)
      const b = index.getX(offset + 1)
      const c = index.getX(offset + 2)
      const pa = endpoint(a)
      const pb = endpoint(b)
      const pc = endpoint(c)
      const centerX = (pa[0] + pb[0] + pc[0]) / 3
      const centerY = (pa[1] + pb[1] + pc[1]) / 3
      const centerZ = (pa[2] + pb[2] + pc[2]) / 3

      if (isOriginalOpenCavityCenter(centerX, centerY, centerZ)) {
        selectedIndices.push(a, b, c)
      }
    }

    if (selectedIndices.length === 0) return

    // Bake the exact jawOpen=100% endpoint authored in Abierto_Dragon into the
    // base position. We no longer interpolate the old open topology: the rigid
    // neutral jaw controls aperture, and this fixed source geometry is merely
    // revealed behind it. This removes the broken intermediate mouth shapes.
    for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
      const [x, y, z] = endpoint(vertexIndex)
      position.setXYZ(vertexIndex, x, y, z)
      morphPosition.setXYZ(vertexIndex, 0, 0, 0)
    }
    position.needsUpdate = true
    morphPosition.needsUpdate = true

    const normal = geometry.getAttribute('normal')
    const morphNormal = geometry.morphAttributes.normal?.[0]
    if (normal && morphNormal) {
      for (let vertexIndex = 0; vertexIndex < normal.count; vertexIndex += 1) {
        let x = relative
          ? normal.getX(vertexIndex) + morphNormal.getX(vertexIndex)
          : morphNormal.getX(vertexIndex)
        let y = relative
          ? normal.getY(vertexIndex) + morphNormal.getY(vertexIndex)
          : morphNormal.getY(vertexIndex)
        let z = relative
          ? normal.getZ(vertexIndex) + morphNormal.getZ(vertexIndex)
          : morphNormal.getZ(vertexIndex)
        const length = Math.hypot(x, y, z)
        if (length > 0.000001) {
          x /= length
          y /= length
          z /= length
        }
        normal.setXYZ(vertexIndex, x, y, z)
        morphNormal.setXYZ(vertexIndex, 0, 0, 0)
      }
      normal.needsUpdate = true
      morphNormal.needsUpdate = true
    }

    geometry.setIndex(selectedIndices)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    keptTriangles += selectedIndices.length / 3
  })

  return keptTriangles
}

export function resolveDualTopologyJaw(
  jawOpen: number,
  wasOpen: boolean,
): { openActive: boolean; morphJaw: number; jawAngleRad: number } {
  const jaw = clamp01(jawOpen)
  let openActive = wasOpen

  if (!openActive && jaw >= DUAL_TOPOLOGY_ENTER_JAW) openActive = true
  if (openActive && jaw <= DUAL_TOPOLOGY_EXIT_JAW) openActive = false

  return {
    openActive,
    // The oral interior is already baked at the authoritative original-open
    // endpoint. It must never be morphed again.
    morphJaw: 0,
    jawAngleRad: jaw * RIGID_JAW_MAX_ANGLE_RAD,
  }
}

export function rigidJawPivotOffset(angleRad: number): { y: number; z: number } {
  const cosine = Math.cos(angleRad)
  const sine = Math.sin(angleRad)

  return {
    y: RIGID_JAW_HINGE_Y * (1 - cosine) + RIGID_JAW_HINGE_Z * sine,
    z: RIGID_JAW_HINGE_Z * (1 - cosine) - RIGID_JAW_HINGE_Y * sine,
  }
}

function installRegionalHybridRuntime(): void {
  if (prototype[patchMarker]) return
  prototype[patchMarker] = true

  const originalLoad = prototype.load
  const originalApplyExpression = prototype.applyExpression

  prototype.load = async function loadWithRegionalHybrid(file: Blob): Promise<void> {
    await originalLoad.call(this, file)

    const root = (this as unknown as RendererPrivateView).modelRoot
    const headRoot = root?.getObjectByName(HEAD_NODE_NAME) ?? null
    const neutralMouthRoot = root?.getObjectByName(NEUTRAL_MOUTH_NODE_NAME) ?? null
    const openMouthRoot = root?.getObjectByName(OPEN_MOUTH_NODE_NAME) ?? null

    if (!headRoot || !neutralMouthRoot || !openMouthRoot) {
      states.delete(this)
      return
    }

    const cavityTriangles = bakeOriginalOpenEndpointInterior(openMouthRoot)
    if (cavityTriangles === 0) {
      states.delete(this)
      openMouthRoot.visible = false
      return
    }

    headRoot.visible = true
    neutralMouthRoot.visible = true
    openMouthRoot.visible = false
    states.set(this, {
      headRoot,
      neutralMouthRoot,
      openMouthRoot,
      openActive: false,
      neutralBaseY: neutralMouthRoot.position.y,
      neutralBaseZ: neutralMouthRoot.position.z,
      neutralBaseRotationX: neutralMouthRoot.rotation.x,
    })
  }

  prototype.applyExpression = function applyExpressionWithRegionalHybrid(
    expression: DragonExpressionState,
  ): void {
    const state = states.get(this)
    if (!state) {
      originalApplyExpression.call(this, expression)
      return
    }

    const resolved = resolveDualTopologyJaw(expression.jawOpen, state.openActive)
    state.openActive = resolved.openActive

    // Rotate only the exact neutral lower jaw around the fixed hinge. The rest
    // of the head and hocico never stretch with jawOpen.
    const pivotOffset = rigidJawPivotOffset(resolved.jawAngleRad)
    state.neutralMouthRoot.rotation.x = state.neutralBaseRotationX + resolved.jawAngleRad
    state.neutralMouthRoot.position.y = state.neutralBaseY + pivotOffset.y
    state.neutralMouthRoot.position.z = state.neutralBaseZ + pivotOffset.z

    state.headRoot.visible = true
    state.neutralMouthRoot.visible = true
    state.openMouthRoot.visible = resolved.openActive

    // The original-open cavity is baked and fixed. Send jawOpen=0 through the
    // native morph path so no legacy topology can deform it a second time.
    originalApplyExpression.call(this, {
      ...expression,
      jawOpen: 0,
    })
  }
}

installRegionalHybridRuntime()
