import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import { estimateStaticDragonPose } from './staticPose'

function resultWithLandmarks(
  patch: Partial<Record<number, { x: number; y: number; z: number }>> = {},
): FaceLandmarkerResult {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  const defaults: Record<number, { x: number; y: number; z: number }> = {
    10: { x: 0.5, y: 0.2, z: 0 },
    152: { x: 0.5, y: 0.8, z: 0 },
    234: { x: 0.3, y: 0.5, z: 0 },
    454: { x: 0.7, y: 0.5, z: 0 },
    33: { x: 0.4, y: 0.42, z: 0 },
    263: { x: 0.6, y: 0.42, z: 0 },
    1: { x: 0.5, y: 0.5, z: -0.05 },
  }

  for (const [index, value] of Object.entries({ ...defaults, ...patch })) {
    landmarks[Number(index)] = value
  }

  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [],
    facialTransformationMatrixes: [],
  } as FaceLandmarkerResult
}

describe('estimateStaticDragonPose', () => {
  it('returns a centered neutral pose for a frontal face', () => {
    const pose = estimateStaticDragonPose(resultWithLandmarks())

    expect(pose.visible).toBe(true)
    expect(pose.centerX).toBeCloseTo(0.5)
    expect(pose.faceWidth).toBeCloseTo(0.4)
    expect(pose.roll).toBeCloseTo(0)
    expect(pose.yaw).toBeCloseTo(0)
    expect(pose.pitch).toBeCloseTo(0)
  })

  it('detects roll and horizontal depth rotation', () => {
    const pose = estimateStaticDragonPose(resultWithLandmarks({
      33: { x: 0.4, y: 0.38, z: 0 },
      263: { x: 0.6, y: 0.46, z: 0 },
      234: { x: 0.3, y: 0.5, z: 0.08 },
      454: { x: 0.7, y: 0.5, z: -0.08 },
    }))

    expect(pose.roll).toBeGreaterThan(0)
    expect(pose.yaw).toBeGreaterThan(0)
  })

  it('returns invisible without landmarks', () => {
    expect(estimateStaticDragonPose(null).visible).toBe(false)
  })
})
