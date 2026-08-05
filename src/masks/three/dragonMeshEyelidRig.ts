import type { Box3, Object3D, Vector3 } from 'three'

/**
 * Synthetic eyelids are intentionally disabled.
 *
 * FaceCam must never draw replacement eyes or deform broad regions of the
 * dragon's face to imitate a blink. The original GLB remains untouched until
 * its real eyelid rig can be inspected and repaired directly.
 */
export interface DragonMeshEyelidBinding {
  readonly disabled: true
}

export function createDragonMeshEyelidRig(
  _root: Object3D,
  _bounds: Box3,
  _size: Vector3,
  _center: Vector3,
  _modelEyeY: number,
): DragonMeshEyelidBinding[] {
  return []
}

export function applyDragonMeshEyelidRig(
  _bindings: DragonMeshEyelidBinding[],
  _blinkLeft: number,
  _blinkRight: number,
): void {
  // Deliberate no-op: do not alter the model's eyes, nose, snout or cheeks.
}
