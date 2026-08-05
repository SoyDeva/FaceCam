import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import {
  estimateStaticDragonPose,
  resolveStaticDragonYaw,
  smoothStaticDragonPose,
} from './staticPose'

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
    33: landmark(0.38, 0.42),
    133: landmark(0.46, 0.42),
    362: landmark(0.54, 0.42),
    263: landmark(0.62, 0.42),
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
  it('anchors a frontal face to the midpoint between both eyes', () => {
    const pose = estimateStaticDragonPose(resultWithLandmarks())

    expect(pose.visible).toBe(true)
    expect(pose.eyeCenterX).toBeCloseTo(0.5)
    expect(pose.eyeCenterY).toBeCloseTo(0.42)
    expect(pose.centerX).toBeCloseTo(pose.eyeCenterX)
    expect(pose.centerY).toBeCloseTo(pose.eyeCenterY)
    expect(pose.eyeDistance).toBeCloseTo(0.16)
    expect(pose.faceWidth).toBeCloseTo(0.4)
    expect(pose.faceHeight).toBeCloseTo(0.6)
    expect(pose.roll).toBeCloseTo(0)
    expect(pose.yaw).toBeCloseTo(0)
    expect(pose.pitch).toBeCloseTo(0)
  })

  it('detects roll and horizontal depth rotation', () => {
    const pose = estimateStaticDragonPose(resultWithLandmarks({
      33: landmark(0.38, 0.38),
      133: landmark(0.46, 0.38),
      362: landmark(0.54, 0.46),
      263: landmark(0.62, 0.46),
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

describe('smoothStaticDragonPose', () => {
  it('smooths intentional translation while preserving visibility', () => {
    const previous = estimateStaticDragonPose(resultWithLandmarks())
    const next = { ...previous, eyeCenterX: 0.7, centerX: 0.7 }
    const smoothed = smoothStaticDragonPose(previous, next, 0.5)

    expect(smoothed.visible).toBe(true)
    expect(smoothed.eyeCenterX).toBeGreaterThan(0.59)
    expect(smoothed.eyeCenterX).toBeLessThan(0.61)
  })

  it('holds sub-pixel head and rotation noise completely still', () => {
    const previous = estimateStaticDragonPose(resultWithLandmarks())
    const next = {
      ...previous,
      centerX: previous.centerX + 0.001,
      centerY: previous.centerY - 0.001,
      eyeCenterX: previous.eyeCenterX + 0.001,
      eyeCenterY: previous.eyeCenterY - 0.001,
      yaw: previous.yaw + 0.01,
      pitch: previous.pitch - 0.01,
      roll: previous.roll + 0.008,
    }
    const smoothed = smoothStaticDragonPose(previous, next)

    expect(smoothed.centerX).toBe(previous.centerX)
    expect(smoothed.centerY).toBe(previous.centerY)
    expect(smoothed.eyeCenterX).toBe(previous.eyeCenterX)
    expect(smoothed.eyeCenterY).toBe(previous.eyeCenterY)
    expect(smoothed.yaw).toBe(previous.yaw)
    expect(smoothed.pitch).toBe(previous.pitch)
    expect(smoothed.roll).toBe(previous.roll)
  })

  it('ignores weak mouth noise at rest', () => {
    const previous = {
      ...estimateStaticDragonPose(resultWithLandmarks()),
      jawOpen: 0,
    }
    const next = { ...previous, jawOpen: 0.16 }
    const smoothed = smoothStaticDragonPose(previous, next)

    expect(smoothed.jawOpen).toBe(0)
  })

  it('responds clearly to intentional speech', () => {
    const previous = {
      ...estimateStaticDragonPose(resultWithLandmarks()),
      jawOpen: 0,
    }
    const next = { ...previous, jawOpen: 0.8 }
    const smoothed = smoothStaticDragonPose(previous, next)

    expect(smoothed.jawOpen).toBeGreaterThan(0.45)
  })

  it('ignores weak eyelid noise but accepts a decisive blink', () => {
    const previous = {
      ...estimateStaticDragonPose(resultWithLandmarks()),
      blinkLeft: 0,
    }
    const noisy = smoothStaticDragonPose(previous, { ...previous, blinkLeft: 0.35 })
    const blink = smoothStaticDragonPose(previous, { ...previous, blinkLeft: 1 })

    expect(noisy.blinkLeft).toBe(0)
    expect(blink.blinkLeft).toBeGreaterThan(0.8)
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
