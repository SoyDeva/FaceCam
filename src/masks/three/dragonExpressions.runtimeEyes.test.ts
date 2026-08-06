import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  estimateDragonExpression,
  resetRuntimeDragonEyeTracking,
} from './dragonExpressions'
import type { DragonExpressionCalibration } from './expressionCalibration'

function landmark(x: number, y: number, z = 0): NormalizedLandmark {
  return { x, y, z, visibility: 1 }
}

function resultWithEyes(
  leftOpening: number,
  rightOpening: number,
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

  setEye(33, 133, [159, 160, 158], [145, 144, 153], 0.39, leftOpening)
  setEye(362, 263, [386, 385, 387], [374, 380, 373], 0.61, rightOpening)

  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [{
      categories: [
        { categoryName: 'jawOpen', score: 0.04, index: 0, displayName: '' },
        { categoryName: 'eyeBlinkLeft', score: leftBlink, index: 1, displayName: '' },
        { categoryName: 'eyeBlinkRight', score: rightBlink, index: 2, displayName: '' },
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
  jawSpeech: 0.16,
  mouthHeightNeutral: 0.02,
  mouthHeightSpeech: 0.06,
  mouthWidthNeutral: 0.07,
  mouthWidthSpeech: 0.2,
  leftEyeOpen: 0.3,
  leftEyeClosed: 0.28,
  rightEyeOpen: 0.31,
  rightEyeClosed: 0.29,
  leftBlinkOpen: 0.45,
  leftBlinkClosed: 0.7,
  rightBlinkOpen: 0.46,
  rightBlinkClosed: 0.71,
  quality: 0.9,
  capturedAt: 1,
}

describe('live per-eye blink baselines', () => {
  beforeEach(() => resetRuntimeDragonEyeTracking())

  it('learns asymmetric open eyes and closes both with geometry alone', () => {
    for (let frame = 0; frame < 20; frame += 1) {
      const open = estimateDragonExpression(resultWithEyes(0.14, 0.1), staleCalibration)
      expect(open.blinkLeft).toBe(0)
      expect(open.blinkRight).toBe(0)
    }

    const closed = estimateDragonExpression(resultWithEyes(0.03, 0.025), staleCalibration)
    expect(closed.blinkLeft).toBeGreaterThan(0.85)
    expect(closed.blinkRight).toBeGreaterThan(0.85)

    const reopened = estimateDragonExpression(resultWithEyes(0.14, 0.1), staleCalibration)
    expect(reopened.blinkLeft).toBe(0)
    expect(reopened.blinkRight).toBe(0)
  })

  it('keeps independent winks when MediaPipe blendshapes stay at zero', () => {
    for (let frame = 0; frame < 20; frame += 1) {
      estimateDragonExpression(resultWithEyes(0.13, 0.105), staleCalibration)
    }

    const wink = estimateDragonExpression(resultWithEyes(0.028, 0.105), staleCalibration)
    expect(wink.blinkLeft).toBeGreaterThan(0.85)
    expect(wink.blinkRight).toBe(0)
  })

  it('does not let a learned zero suppress direct blink evidence', () => {
    for (let frame = 0; frame < 20; frame += 1) {
      estimateDragonExpression(resultWithEyes(0.13, 0.105), staleCalibration)
    }

    const blink = estimateDragonExpression(
      resultWithEyes(0.13, 0.105, 0.5, 0.5),
      staleCalibration,
    )
    expect(blink.blinkLeft).toBeGreaterThan(0.9)
    expect(blink.blinkRight).toBeGreaterThan(0.9)
  })
})
