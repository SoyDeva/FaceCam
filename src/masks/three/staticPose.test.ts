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

function resultWithLandmarks(options: {
  centerX?: number
  centerY?: number
  roll?: number
  yawDepth?: number
  jawOpen?: number
  blinkLeft?: number
  blinkRight?: number
} = {}): FaceLandmarkerResult {
  const {
    centerX = 0.5,
    centerY = 0.45,
    roll = 0,
    yawDepth = 0,
    jawOpen = 0,
    blinkLeft = 0,
    blinkRight = 0,
  } = options
  const landmarks = Array.from({ length: 478 }, () => landmark(centerX, centerY))
  const faceHeight = 0.32
  const faceWidth = 0.28
  const eyeDistance = 0.13
  const eyeDy = Math.sin(roll) * eyeDistance / 2
  const eyeDx = Math.cos(roll) * eyeDistance / 2

  landmarks[10] = landmark(centerX, centerY - faceHeight * 0.44)
  landmarks[152] = landmark(centerX, centerY + faceHeight * 0.56)
  landmarks[234] = landmark(centerX - faceWidth / 2, centerY, yawDepth / 2)
  landmarks[454] = landmark(centerX + faceWidth / 2, centerY, -yawDepth / 2)
  landmarks[33] = landmark(centerX - eyeDx - 0.02, centerY - eyeDy)
  landmarks[133] = landmark(centerX - eyeDx + 0.02, centerY - eyeDy)
  landmarks[362] = landmark(centerX + eyeDx - 0.02, centerY + eyeDy)
  landmarks[263] = landmark(centerX + eyeDx + 0.02, centerY + eyeDy)
  landmarks[1] = landmark(centerX, centerY)

  // Expression geometry required by the live auto estimator.
  landmarks[61] = landmark(centerX - 0.08, centerY + 0.07)
  landmarks[291] = landmark(centerX + 0.08, centerY + 0.07)
  landmarks[13] = landmark(centerX, centerY + 0.068)
  landmarks[14] = landmark(centerX, centerY + 0.072)

  const setEyeGeometry = (
    outer: number,
    inner: number,
    upper: readonly [number, number, number],
    lower: readonly [number, number, number],
    eyeCenterX: number,
  ) => {
    const width = 0.04
    const gap = 0.14 * width
    landmarks[outer] = landmark(eyeCenterX - width / 2, centerY)
    landmarks[inner] = landmark(eyeCenterX + width / 2, centerY)
    for (let index = 0; index < 3; index += 1) {
      const x = eyeCenterX + (index - 1) * 0.005
      landmarks[upper[index]] = landmark(x, centerY - gap / 2)
      landmarks[lower[index]] = landmark(x, centerY + gap / 2)
    }
  }
  setEyeGeometry(33, 133, [159, 160, 158], [145, 144, 153], centerX - eyeDx)
  setEyeGeometry(362, 263, [386, 385, 387], [374, 380, 373], centerX + eyeDx)

  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [{
      categories: [
        { categoryName: 'jawOpen', score: jawOpen, index: 0, displayName: '' },
        { categoryName: 'eyeBlinkLeft', score: blinkLeft, index: 1, displayName: '' },
        { categoryName: 'eyeBlinkRight', score: blinkRight, index: 2, displayName: '' },
        { categoryName: 'mouthClose', score: 0, index: 3, displayName: '' },
      ],
      headIndex: 0,
      headName: '',
    }],
    facialTransformationMatrixes: [],
  } as unknown as FaceLandmarkerResult
}

describe('estimateStaticDragonPose', () => {
  it('anchors a frontal face to the midpoint between both eyes', () => {
    const pose = estimateStaticDragonPose(resultWithLandmarks({ centerX: 0.52, centerY: 0.43 }))

    expect(pose.visible).toBe(true)
    expect(pose.eyeCenterX).toBeCloseTo(0.52, 4)
    expect(pose.eyeCenterY).toBeCloseTo(0.43, 4)
    expect(pose.roll).toBeCloseTo(0, 4)
  })

  it('detects roll and horizontal depth rotation', () => {
    const pose = estimateStaticDragonPose(resultWithLandmarks({ roll: 0.2, yawDepth: 0.08 }))

    expect(pose.roll).toBeGreaterThan(0.15)
    expect(pose.yaw).toBeGreaterThan(0.2)
  })

  it('returns invisible without landmarks', () => {
    const pose = estimateStaticDragonPose(null)
    expect(pose.visible).toBe(false)
  })
})

describe('smoothStaticDragonPose', () => {
  it('smooths intentional translation while preserving visibility', () => {
    const previous = estimateStaticDragonPose(resultWithLandmarks({ centerX: 0.48 }))
    const next = estimateStaticDragonPose(resultWithLandmarks({ centerX: 0.58 }))
    const smoothed = smoothStaticDragonPose(previous, next)

    expect(smoothed.visible).toBe(true)
    expect(smoothed.centerX).toBeGreaterThan(previous.centerX)
    expect(smoothed.centerX).toBeLessThan(next.centerX)
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

  it('ignores weak mouth noise at rest on the v30 proportional scale', () => {
    const previous = {
      ...estimateStaticDragonPose(resultWithLandmarks()),
      jawOpen: 0,
    }
    const next = { ...previous, jawOpen: 0.05 }
    const smoothed = smoothStaticDragonPose(previous, next)

    expect(smoothed.jawOpen).toBe(0)
  })

  it('lets small intentional speech start moving the jaw on the v30 scale', () => {
    const previous = {
      ...estimateStaticDragonPose(resultWithLandmarks()),
      jawOpen: 0,
    }
    const next = { ...previous, jawOpen: 0.16 }
    const smoothed = smoothStaticDragonPose(previous, next)

    expect(smoothed.jawOpen).toBeGreaterThan(0.08)
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

  it('does not stretch or pitch the dragon when jaw motion moves the chin landmark', () => {
    const previous = {
      ...estimateStaticDragonPose(resultWithLandmarks()),
      jawOpen: 0,
    }
    const next = {
      ...previous,
      jawOpen: 0.8,
      faceHeight: previous.faceHeight + 0.18,
      neckAnchorX: previous.neckAnchorX + 0.04,
      neckAnchorY: previous.neckAnchorY + 0.14,
      pitch: previous.pitch + 0.2,
    }
    const smoothed = smoothStaticDragonPose(previous, next)

    expect(smoothed.jawOpen).toBeGreaterThan(0.45)
    expect(smoothed.faceHeight).toBe(previous.faceHeight)
    expect(smoothed.neckAnchorX).toBe(previous.neckAnchorX)
    expect(smoothed.neckAnchorY).toBe(previous.neckAnchorY)
    expect(smoothed.pitch).toBe(previous.pitch)
  })

  it('ignores weak eyelid noise but accepts a decisive blink', () => {
    const previous = {
      ...estimateStaticDragonPose(resultWithLandmarks()),
      blinkLeft: 0,
    }
    const noisy = smoothStaticDragonPose(previous, { ...previous, blinkLeft: 0.08 })
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
