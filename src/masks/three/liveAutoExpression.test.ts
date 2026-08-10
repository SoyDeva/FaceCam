import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  estimateLiveAutoDragonExpression,
  resetLiveAutoExpressionCalibration,
} from './liveAutoExpression'

function landmark(x: number, y: number, z = 0): NormalizedLandmark {
  return { x, y, z, visibility: 1 }
}

interface FrameOptions {
  jawOpen?: number
  mouthGap?: number
  leftEyeOpening?: number
  rightEyeOpening?: number
  leftBlink?: number
  rightBlink?: number
  mouthClose?: number
}

function frame({
  jawOpen = 0.002,
  mouthGap = 0.004,
  leftEyeOpening = 0.387,
  rightEyeOpening = 0.385,
  leftBlink = 0.344,
  rightBlink = 0.300,
  mouthClose = 0.001,
}: FrameOptions = {}): FaceLandmarkerResult {
  const landmarks = Array.from({ length: 478 }, () => landmark(0.5, 0.5))
  landmarks[10] = landmark(0.5, 0.2)
  landmarks[152] = landmark(0.5, 0.8)
  landmarks[61] = landmark(0.42, 0.56)
  landmarks[291] = landmark(0.58, 0.56)
  landmarks[13] = landmark(0.5, 0.56 - mouthGap / 2)
  landmarks[14] = landmark(0.5, 0.56 + mouthGap / 2)

  const setEye = (
    outer: number,
    inner: number,
    upper: readonly [number, number, number],
    lower: readonly [number, number, number],
    centerX: number,
    opening: number,
  ) => {
    const width = 0.08
    const gap = opening * width
    landmarks[outer] = landmark(centerX - width / 2, 0.42)
    landmarks[inner] = landmark(centerX + width / 2, 0.42)
    for (let index = 0; index < 3; index += 1) {
      const x = centerX + (index - 1) * 0.01
      landmarks[upper[index]] = landmark(x, 0.42 - gap / 2)
      landmarks[lower[index]] = landmark(x, 0.42 + gap / 2)
    }
  }

  setEye(33, 133, [159, 160, 158], [145, 144, 153], 0.39, leftEyeOpening)
  setEye(362, 263, [386, 385, 387], [374, 380, 373], 0.61, rightEyeOpening)

  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [{
      categories: [
        { categoryName: 'jawOpen', score: jawOpen, index: 0, displayName: '' },
        { categoryName: 'eyeBlinkLeft', score: leftBlink, index: 1, displayName: '' },
        { categoryName: 'eyeBlinkRight', score: rightBlink, index: 2, displayName: '' },
        { categoryName: 'mouthClose', score: mouthClose, index: 3, displayName: '' },
      ],
      headIndex: 0,
      headName: '',
    }],
    facialTransformationMatrixes: [],
  } as unknown as FaceLandmarkerResult
}

describe('automatic live expression calibration', () => {
  beforeEach(() => resetLiveAutoExpressionCalibration())

  it('treats the captured open-eye blink noise as neutral', () => {
    const expression = estimateLiveAutoDragonExpression(frame())

    expect(expression.blinkLeft).toBe(0)
    expect(expression.blinkRight).toBe(0)
    expect(expression.jawOpen).toBe(0)
  })

  it('keeps closed lips closed even if MediaPipe jawOpen spikes', () => {
    estimateLiveAutoDragonExpression(frame())
    const expression = estimateLiveAutoDragonExpression(frame({
      jawOpen: 0.35,
      mouthGap: 0.0042,
    }))

    expect(expression.jawOpen).toBe(0)
  })

  it('uses a proportional speech range instead of saturating around jawOpen 0.11', () => {
    for (let index = 0; index < 4; index += 1) {
      estimateLiveAutoDragonExpression(frame())
    }

    const ordinary = estimateLiveAutoDragonExpression(frame({
      jawOpen: 0.11,
      mouthGap: 0.025,
    }))
    const strong = estimateLiveAutoDragonExpression(frame({
      jawOpen: 0.412,
      mouthGap: 0.074,
    }))
    const wide = estimateLiveAutoDragonExpression(frame({
      jawOpen: 0.533,
      mouthGap: 0.088,
    }))

    expect(ordinary.jawOpen).toBeGreaterThan(0.10)
    expect(ordinary.jawOpen).toBeLessThan(0.22)
    expect(strong.jawOpen).toBeGreaterThan(ordinary.jawOpen)
    expect(strong.jawOpen).toBeLessThan(0.52)
    expect(wide.jawOpen).toBeGreaterThan(strong.jawOpen)
    expect(wide.jawOpen).toBeLessThanOrEqual(0.68)
  })

  it('tracks a slow blink from the observed 0.49/0.43 open-eye geometry instead of staying static', () => {
    for (let index = 0; index < 4; index += 1) {
      const open = estimateLiveAutoDragonExpression(frame({
        leftEyeOpening: 0.490,
        rightEyeOpening: 0.427,
        leftBlink: 0.274,
        rightBlink: 0.154,
      }))
      expect(open.blinkLeft).toBe(0)
      expect(open.blinkRight).toBe(0)
    }

    const beginning = estimateLiveAutoDragonExpression(frame({
      leftEyeOpening: 0.420,
      rightEyeOpening: 0.370,
      leftBlink: 0.380,
      rightBlink: 0.300,
    }))
    expect(beginning.blinkLeft).toBeGreaterThan(0.08)
    expect(beginning.blinkRight).toBeGreaterThan(0.08)

    const middle = estimateLiveAutoDragonExpression(frame({
      leftEyeOpening: 0.300,
      rightEyeOpening: 0.260,
      leftBlink: 0.550,
      rightBlink: 0.500,
    }))
    expect(middle.blinkLeft).toBeGreaterThan(beginning.blinkLeft)
    expect(middle.blinkRight).toBeGreaterThan(beginning.blinkRight)

    const closed = estimateLiveAutoDragonExpression(frame({
      leftEyeOpening: 0.100,
      rightEyeOpening: 0.090,
      leftBlink: 0.780,
      rightBlink: 0.750,
    }))
    expect(closed.blinkLeft).toBeGreaterThan(0.9)
    expect(closed.blinkRight).toBeGreaterThan(0.9)

    const reopened = estimateLiveAutoDragonExpression(frame({
      leftEyeOpening: 0.490,
      rightEyeOpening: 0.427,
      leftBlink: 0.274,
      rightBlink: 0.154,
    }))
    expect(reopened.blinkLeft).toBe(0)
    expect(reopened.blinkRight).toBe(0)
  })

  it('still closes both dragon eyes for a real geometric blink', () => {
    for (let index = 0; index < 3; index += 1) {
      estimateLiveAutoDragonExpression(frame())
    }

    const expression = estimateLiveAutoDragonExpression(frame({
      leftEyeOpening: 0.055,
      rightEyeOpening: 0.052,
      leftBlink: 0.88,
      rightBlink: 0.86,
    }))

    expect(expression.blinkLeft).toBeGreaterThan(0.8)
    expect(expression.blinkRight).toBeGreaterThan(0.8)
    expect(expression.jawOpen).toBe(0)
  })
})
