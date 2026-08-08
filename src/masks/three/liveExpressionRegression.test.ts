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

function resultFor(
  jawOpen: number,
  mouthGap: number,
  eyeOpening: number,
  blinkLeft: number,
  blinkRight = blinkLeft,
): FaceLandmarkerResult {
  const landmarks = Array.from({ length: 478 }, () => landmark(0.5, 0.5))
  landmarks[10] = landmark(0.5, 0.2)
  landmarks[152] = landmark(0.5, 0.8)
  landmarks[61] = landmark(0.42, 0.56)
  landmarks[291] = landmark(0.58, 0.56)
  landmarks[13] = landmark(0.5, 0.56 - mouthGap / 2)
  landmarks[14] = landmark(0.5, 0.56 + mouthGap / 2)
  landmarks[0] = landmark(0.5, 0.56 - mouthGap / 2)
  landmarks[17] = landmark(0.5, 0.56 + mouthGap / 2)

  const eyeGap = eyeOpening * 0.08
  landmarks[33] = landmark(0.35, 0.42)
  landmarks[133] = landmark(0.43, 0.42)
  landmarks[159] = landmark(0.39, 0.42 - eyeGap / 2)
  landmarks[145] = landmark(0.39, 0.42 + eyeGap / 2)
  landmarks[160] = landmark(0.38, 0.42 - eyeGap / 2)
  landmarks[144] = landmark(0.38, 0.42 + eyeGap / 2)
  landmarks[158] = landmark(0.4, 0.42 - eyeGap / 2)
  landmarks[153] = landmark(0.4, 0.42 + eyeGap / 2)

  landmarks[362] = landmark(0.57, 0.42)
  landmarks[263] = landmark(0.65, 0.42)
  landmarks[386] = landmark(0.61, 0.42 - eyeGap / 2)
  landmarks[374] = landmark(0.61, 0.42 + eyeGap / 2)
  landmarks[385] = landmark(0.6, 0.42 - eyeGap / 2)
  landmarks[380] = landmark(0.6, 0.42 + eyeGap / 2)
  landmarks[387] = landmark(0.62, 0.42 - eyeGap / 2)
  landmarks[373] = landmark(0.62, 0.42 + eyeGap / 2)

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

const staleEyeCalibration: DragonExpressionCalibration = {
  version: 1,
  jawNeutral: 0.04,
  jawSpeech: 0.16,
  mouthHeightNeutral: 0.02,
  mouthHeightSpeech: 0.055,
  mouthWidthNeutral: 0.075,
  mouthWidthSpeech: 0.2,
  leftEyeOpen: 0.22,
  leftEyeClosed: 0.035,
  rightEyeOpen: 0.22,
  rightEyeClosed: 0.035,
  leftBlinkOpen: 0.03,
  leftBlinkClosed: 0.82,
  rightBlinkOpen: 0.03,
  rightBlinkClosed: 0.82,
  quality: 0.9,
  capturedAt: 1,
}

describe('live expression regressions', () => {
  beforeEach(() => resetRuntimeDragonEyeTracking())

  it('keeps the jaw responsive before guided expression calibration exists', () => {
    const expression = estimateDragonExpression(
      resultFor(0.18, 0.04, 0.14, 0.03),
      null,
    )

    expect(expression.blinkLeft).toBe(0)
    expect(expression.blinkRight).toBe(0)
    expect(expression.jawOpen).toBeGreaterThan(0.25)
  })

  it('lets live open-eye geometry veto a stale calibration that would half-close the eyes', () => {
    const expression = estimateDragonExpression(
      resultFor(0.04, 0.012, 0.14, 0.08),
      staleEyeCalibration,
    )

    expect(expression.blinkLeft).toBe(0)
    expect(expression.blinkRight).toBe(0)
  })

  it('still blocks a false jaw spike during a real bilateral blink', () => {
    const expression = estimateDragonExpression(
      resultFor(0.95, 0.018, 0.035, 0.9),
      staleEyeCalibration,
    )

    expect(expression.blinkLeft).toBeGreaterThan(0.8)
    expect(expression.blinkRight).toBeGreaterThan(0.8)
    expect(expression.jawOpen).toBe(0)
  })
})
