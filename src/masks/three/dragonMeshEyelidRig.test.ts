import { Box3, Object3D, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  applyDragonMeshEyelidRig,
  createDragonMeshEyelidRig,
} from './dragonMeshEyelidRig'

describe('dragon mesh eyelid safety', () => {
  it('does not create replacement eyes or eyelids over the GLB', () => {
    const bindings = createDragonMeshEyelidRig(
      new Object3D(),
      new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
      new Vector3(2, 2, 2),
      new Vector3(),
      0,
    )

    expect(bindings).toEqual([])
  })

  it('does not deform the face when blink signals arrive', () => {
    expect(() => applyDragonMeshEyelidRig([], 1, 1)).not.toThrow()
  })
})
