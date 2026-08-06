import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  estimateDragonExpression,
  resetRuntimeDragonEyeTracking,
  smoothDragonExpression,
  NEUTRAL_DRAGON_EXPRESSION,
} from './dragonExpressions'
import type { DragonExpressionCalibration } from './expressionCalibration'

// Source-only verification trigger for the final live per-eye controller.
function landmark(x: number, y: number, z = 0): NormalizedLandmark {
  return { x, y, z, visibility: 1 }
}

function resultFor(
  leftEyeOpening: number,
  rightEyeOpening: number,
  leftBlink = 0,
  rightBlink = 0,
): FaceLandmarkerResult {
  const landmarks = Array.from({ length: 478 }, () => landmark(0.5, 0.5))
  landmarks[10] = landmark(0.5, 0.2)
  landmarks[152] = landmark(0.5, 0.8)
  landmarks[61] = landmark(0.42, 0.56)
  landmarks[291] = landmark(0.58, 0.56)
  landmarks[13] = landmark(0.5, 0.554)
  landmarks[14] = landmark(0.5, 0.566)
  landmarks[0] = landmark(0.5, 0.554)
  landmarks[17] = landmark(0.5, 0.566)

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
        { categoryName: 'jawOpen', score: 0.03, index: 0, displayName: '' },
        { categoryName: 'eyeBlinkLeft', score: leftBlink, index: 1, displayName: '' },
        { categoryName: 'eyeBlinkRight', score: rightBlink, index: 2, displayName: '' },
        { categoryName: 'mouthClose', score: 0.8, index: 3, displayName: '' },
      ],
      headIndex: 0,
      headName: '',
    }],
    facialTransformationMatrixes: [],
  } as unknown as FaceLandmarkerResult
}

const staleCalibration: DragonExpressionCalibration = {
  version: 1,
  jawNeutral: 0.03,
  jawSpeech: 0.2,
  mouthHeightNeutral: 0.02,
  mouthHeightSpeech: 0.06,
  mouthWidthNeutral: 0.07,
  mouthWidthSpeech: 0.2,
  leftEyeOpen: 0.1,
  leftEyeClosed: 0.03,
  rightEyeOpen: 0.1,
  rightEyeClosed: 0.03,
  leftBlinkOpen: 0.02,
  leftBlinkClosed: 0.8,
  rightBlinkOpen: 0.02,
  rightBlinkClosed: 0.8,
  quality: 0.9,
  capturedAt: 1,
}

describe('live per-eye blink controller', () => {
  beforeEach(() => resetRuntimeDragonEyeTracking())

  it('detects a real-scale left wink without blendshapes or a warm-up delay', () => {
    estimateDragonExpression(resultFor(0.3, 0.26), null)
    const wink = estimateDragonExpression(resultFor(0.14, 0.26), null)

    expect(wink.blinkLeft).toBeGreaterThan(0.9)
    expect(wink.blinkRight).toBe(0)
  })

  it('detects both eyes independently at camera-scale landmark ratios', () => {
    estimateDragonExpression(resultFor(0.31, 0.27), null)
    const blink = estimateDragonExpression(resultFor(0.13, 0.11), null)

    expect(blink.blinkLeft).toBeGreaterThan(0.9)
    expect(blink.blinkRight).toBeGreaterThan(0.9)
  })

  it('does not turn ordinary open-eye variation into a half-closed eye', () => {
    estimateDragonExpression(resultFor(0.3, 0.26), null)
    const variation = estimateDragonExpression(resultFor(0.23, 0.22), null)

    expect(variation.blinkLeft).toBe(0)
    expect(variation.blinkRight).toBe(0)
  })

  it('does not let a stale stored calibration suppress the live eye ratio', () => {
    estimateDragonExpression(resultFor(0.3, 0.26), staleCalibration)
    const blink = estimateDragonExpression(resultFor(0.14, 0.12), staleCalibration)

    expect(blink.blinkLeft).toBeGreaterThan(0.9)
    expect(blink.blinkRight).toBeGreaterThan(0.9)
  })

  it('preserves direct MediaPipe blink evidence when geometry is unavailable', () => {
    const result = {
      faceLandmarks: [],
      faceBlendshapes: [{
        categories: [
          { categoryName: 'eyeBlinkLeft', score: 0.9, index: 0, displayName: '' },
          { categoryName: 'eyeBlinkRight', score: 0.05, index: 1, displayName: '' },
        ],
        headIndex: 0,
        headName: '',
      }],
      facialTransformationMatrixes: [],
    } as unknown as FaceLandmarkerResult

    const expression = estimateDragonExpression(result, staleCalibration)
    expect(expression.blinkLeft).toBeGreaterThan(0.95)
    expect(expression.blinkRight).toBe(0)
  })

  it('drives the smoothed morph channel almost fully on the first closed frame', () => {
    const open = estimateDragonExpression(resultFor(0.3, 0.26), null)
    const closed = estimateDragonExpression(resultFor(0.13, 0.11), null)
    const smoothed = smoothDragonExpression(
      { ...NEUTRAL_DRAGON_EXPRESSION, ...open },
      { ...NEUTRAL_DRAGON_EXPRESSION, ...closed },
    )

    expect(smoothed.blinkLeft).toBeGreaterThan(0.9)
    expect(smoothed.blinkRight).toBeGreaterThan(0.9)
  })
})
