import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import { estimateStaticDragonPose, resolveStaticDragonYaw } from './staticPose'

function landmark(x: number, y: number, z = 0): NormalizedLandmark {
  return { x, y, z, visibility: 1 }
}

function resultWithLandmarks(
  patch: Partial<Record<number, NormalizedLandmark>> = {},
): FaceLandmarkerResult {
  const landmarks: NormalizedLandmark[] = Array.from(
    { length: 478 },
    () => landmark(0.5, 0.5),
  )
  const defaults: Record<number, NormalizedLandmark> = {
    10: landmark(0.5, 0.2),
    152: landmark(0.5, 0.8),
    234: landmark(0.3, 0.5),
    454: landmark(0.7, 0.5),
    33: landmark(0.4, 0.42),
    263: landmark(0.6, 0.42),
    1: landmark(0.5, 0.5, -0.05),
  }

  for (const [index, value] of Object.entries({ ...defaults, ...patch })) {
    if (value) landmarks[Number(index)] = value
  }

  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [],
    facialTransformationMatrixes: [],
  } as unknown as FaceLandmarkerResult
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
      33: landmark(0.4, 0.38),
      263: landmark(0.6, 0.46),
      234: landmark(0.3, 0.5, 0.08),
      454: landmark(0.7, 0.5, -0.08),
    }))

    expect(pose.roll).toBeGreaterThan(0)
    expect(pose.yaw).toBeGreaterThan(0)
  })

  it('returns invisible without landmarks', () => {
    expect(estimateStaticDragonPose(null).visible).toBe(false)
  })
})

describe('resolveStaticDragonYaw', () => {
  it('reverses visual yaw when the preview is mirrored', () => {
    expect(resolveStaticDragonYaw(0.5, 1, false, false)).toBeCloseTo(0.5)
    expect(resolveStaticDragonYaw(0.5, 1, false, true)).toBeCloseTo(-0.5)
  })

  it('preserves the reversed-model base orientation', () => {
    expect(resolveStaticDragonYaw(0, 1, true, false)).toBeCloseTo(Math.PI)
    expect(resolveStaticDragonYaw(0.25, 1, true, true)).toBeCloseTo(Math.PI + 0.25)
  })
})
