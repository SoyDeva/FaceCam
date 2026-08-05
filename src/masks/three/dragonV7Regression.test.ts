import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import { estimateDragonExpression } from './dragonExpressions'
import type { DragonExpressionCalibration } from './expressionCalibration'

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

function resultFor({
  jawOpen = 0.04,
  mouthGap = 0.012,
  leftEyeOpening = 0.14,
  rightEyeOpening = 0.14,
  leftBlink = 0.03,
  rightBlink = 0.03,
  mouthClose = 0,
}: FrameOptions): FaceLandmarkerResult {
  const landmarks = Array.from({ length: 478 }, () => landmark(0.5, 0.5))
  landmarks[10] = landmark(0.5, 0.2)
  landmarks[152] = landmark(0.5, 0.8)
  landmarks[61] = landmark(0.42, 0.56)
  landmarks[291] = landmark(0.58, 0.56)
  landmarks[13] = landmark(0.5, 0.56 - mouthGap / 2)
  landmarks[14] = landmark(0.5, 0.56 + mouthGap / 2)
  landmarks[0] = landmark(0.5, 0.56 - mouthGap / 2)
  landmarks[17] = landmark(0.5, 0.56 + mouthGap / 2)

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

const asymmetricCalibration: DragonExpressionCalibration = {
  version: 1,
  jawNeutral: 0.04,
  jawSpeech: 0.14,
  mouthHeightNeutral: 0.02,
  mouthHeightSpeech: 0.055,
  mouthWidthNeutral: 0.075,
  mouthWidthSpeech: 0.2,
  leftEyeOpen: 0.09,
  leftEyeClosed: 0.03,
  rightEyeOpen: 0.14,
  rightEyeClosed: 0.035,
  leftBlinkOpen: 0.13,
  leftBlinkClosed: 0.82,
  rightBlinkOpen: 0.04,
  rightBlinkClosed: 0.82,
  quality: 0.9,
  capturedAt: 1,
}

describe('v7 per-eye neutral regression', () => {
  it('does not half-close a naturally smaller open eye before calibration', () => {
    const expression = estimateDragonExpression(resultFor({
      leftEyeOpening: 0.09,
      rightEyeOpening: 0.14,
      leftBlink: 0.06,
      rightBlink: 0.04,
    }), null)

    expect(expression.blinkLeft).toBe(0)
    expect(expression.blinkRight).toBe(0)
  })

  it('still detects an obvious uncalibrated wink independently', () => {
    const expression = estimateDragonExpression(resultFor({
      leftEyeOpening: 0.045,
      rightEyeOpening: 0.14,
      leftBlink: 0,
      rightBlink: 0,
    }), null)

    expect(expression.blinkLeft).toBeGreaterThan(0.9)
    expect(expression.blinkRight).toBe(0)
  })

  it('uses each calibrated eye baseline instead of an absolute open threshold', () => {
    const open = estimateDragonExpression(resultFor({
      leftEyeOpening: 0.09,
      rightEyeOpening: 0.14,
      leftBlink: 0.13,
      rightBlink: 0.04,
    }), asymmetricCalibration)
    const wink = estimateDragonExpression(resultFor({
      leftEyeOpening: 0.035,
      rightEyeOpening: 0.14,
      leftBlink: 0.72,
      rightBlink: 0.04,
    }), asymmetricCalibration)

    expect(open.blinkLeft).toBe(0)
    expect(open.blinkRight).toBe(0)
    expect(wink.blinkLeft).toBeGreaterThan(0.9)
    expect(wink.blinkRight).toBe(0)
  })
})

describe('v7 approved mouth regression', () => {
  it('keeps the jaw closed when lips are closed despite a high jawOpen score', () => {
    const expression = estimateDragonExpression(resultFor({
      jawOpen: 0.35,
      mouthGap: 0.0144,
    }), asymmetricCalibration)

    expect(expression.jawOpen).toBe(0)
  })

  it('retains visible non-saturated motion for actual speech', () => {
    const expression = estimateDragonExpression(resultFor({
      jawOpen: 0.105,
      mouthGap: 0.027,
    }), asymmetricCalibration)

    expect(expression.jawOpen).toBeGreaterThan(0.4)
    expect(expression.jawOpen).toBeLessThan(0.7)
  })
})
