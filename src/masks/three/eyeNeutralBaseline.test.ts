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

function resultForEyes(
  leftOpening: number,
  rightOpening: number,
  leftBlink = 0.03,
  rightBlink = 0.03,
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

  const leftGap = leftOpening * 0.08
  landmarks[33] = landmark(0.35, 0.42)
  landmarks[133] = landmark(0.43, 0.42)
  landmarks[159] = landmark(0.39, 0.42 - leftGap / 2)
  landmarks[145] = landmark(0.39, 0.42 + leftGap / 2)
  landmarks[160] = landmark(0.38, 0.42 - leftGap / 2)
  landmarks[144] = landmark(0.38, 0.42 + leftGap / 2)
  landmarks[158] = landmark(0.4, 0.42 - leftGap / 2)
  landmarks[153] = landmark(0.4, 0.42 + leftGap / 2)

  const rightGap = rightOpening * 0.08
  landmarks[362] = landmark(0.57, 0.42)
  landmarks[263] = landmark(0.65, 0.42)
  landmarks[386] = landmark(0.61, 0.42 - rightGap / 2)
  landmarks[374] = landmark(0.61, 0.42 + rightGap / 2)
  landmarks[385] = landmark(0.6, 0.42 - rightGap / 2)
  landmarks[380] = landmark(0.6, 0.42 + rightGap / 2)
  landmarks[387] = landmark(0.62, 0.42 - rightGap / 2)
  landmarks[373] = landmark(0.62, 0.42 + rightGap / 2)

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

const wideOpenCalibration: DragonExpressionCalibration = {
  version: 1,
  jawNeutral: 0.04,
  jawSpeech: 0.14,
  mouthHeightNeutral: 0.02,
  mouthHeightSpeech: 0.055,
  mouthWidthNeutral: 0.075,
  mouthWidthSpeech: 0.2,
  leftEyeOpen: 0.2,
  leftEyeClosed: 0.04,
  rightEyeOpen: 0.2,
  rightEyeClosed: 0.04,
  leftBlinkOpen: 0.03,
  leftBlinkClosed: 0.82,
  rightBlinkOpen: 0.03,
  rightBlinkClosed: 0.82,
  quality: 0.9,
  capturedAt: 1,
}

describe('v7 eye neutral baseline regression', () => {
  beforeEach(() => resetRuntimeDragonEyeTracking())

  it('does not poison neutral after one exaggerated wide-eyed frame', () => {
    estimateDragonExpression(resultForEyes(0.14, 0.14), null)
    estimateDragonExpression(resultForEyes(0.28, 0.28), null)

    const normalAgain = estimateDragonExpression(resultForEyes(0.14, 0.14), null)
    const nextNormal = estimateDragonExpression(resultForEyes(0.14, 0.14), null)

    expect(normalAgain.blinkLeft).toBe(0)
    expect(normalAgain.blinkRight).toBe(0)
    expect(nextNormal.blinkLeft).toBe(0)
    expect(nextNormal.blinkRight).toBe(0)
  })

  it('keeps ordinary open eyes neutral even if calibration captured them too wide', () => {
    const expression = estimateDragonExpression(
      resultForEyes(0.14, 0.14),
      wideOpenCalibration,
    )

    expect(expression.blinkLeft).toBe(0)
    expect(expression.blinkRight).toBe(0)
  })

  it('still produces a decisive independent wink', () => {
    const expression = estimateDragonExpression(
      resultForEyes(0.04, 0.14, 0.78, 0.03),
      wideOpenCalibration,
    )

    expect(expression.blinkLeft).toBeGreaterThan(0.85)
    expect(expression.blinkRight).toBe(0)
  })
})
