import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import {
  estimateDragonExpression,
  NEUTRAL_DRAGON_EXPRESSION,
  smoothDragonExpression,
} from './dragonExpressions'
import type { DragonExpressionCalibration } from './expressionCalibration'

function landmark(x: number, y: number, z = 0): NormalizedLandmark {
  return { x, y, z, visibility: 1 }
}

function resultFor(
  jawOpen: number,
  mouthGap: number,
  eyeOpening: number,
  blink: number,
  mouthWidth = 0.16,
): FaceLandmarkerResult {
  const landmarks = Array.from({ length: 478 }, () => landmark(0.5, 0.5))
  landmarks[10] = landmark(0.5, 0.2)
  landmarks[152] = landmark(0.5, 0.8)
  landmarks[61] = landmark(0.5 - mouthWidth / 2, 0.56)
  landmarks[291] = landmark(0.5 + mouthWidth / 2, 0.56)
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
        { categoryName: 'eyeBlinkLeft', score: blink, index: 1, displayName: '' },
        { categoryName: 'eyeBlinkRight', score: blink, index: 2, displayName: '' },
      ],
      headIndex: 0,
      headName: '',
    }],
    facialTransformationMatrixes: [],
  } as unknown as FaceLandmarkerResult
}

const calibration: DragonExpressionCalibration = {
  version: 1,
  jawNeutral: 0.04,
  jawSpeech: 0.14,
  mouthHeightNeutral: 0.02,
  mouthHeightSpeech: 0.055,
  mouthWidthNeutral: 0.075,
  mouthWidthSpeech: 0.2,
  leftEyeOpen: 0.14,
  leftEyeClosed: 0.035,
  rightEyeOpen: 0.14,
  rightEyeClosed: 0.035,
  leftBlinkOpen: 0.03,
  leftBlinkClosed: 0.82,
  rightBlinkOpen: 0.03,
  rightBlinkClosed: 0.82,
  quality: 0.9,
  capturedAt: 1,
}

describe('estimateDragonExpression', () => {
  it('stays neutral until a guided calibration exists', () => {
    expect(estimateDragonExpression(resultFor(0.12, 0.03, 0.14, 0.02), null))
      .toEqual(NEUTRAL_DRAGON_EXPRESSION)
  })

  it('holds realistic camera noise completely closed', () => {
    const expression = estimateDragonExpression(resultFor(0.045, 0.0128, 0.137, 0.04), calibration)
    expect(expression.jawOpen).toBe(0)
    expect(expression.blinkLeft).toBe(0)
    expect(expression.blinkRight).toBe(0)
  })

  it('does not open the jaw when a closed mouth only becomes wider', () => {
    const expression = estimateDragonExpression(
      resultFor(0.045, 0.0128, 0.137, 0.04, 0.34),
      calibration,
    )
    expect(expression.jawOpen).toBe(0)
  })

  it('closes between syllables even when MediaPipe jawOpen remains elevated', () => {
    const expression = estimateDragonExpression(
      resultFor(0.12, 0.0132, 0.14, 0.03),
      calibration,
    )
    expect(expression.jawOpen).toBe(0)
  })

  it('maps normal speech to a visible but non-saturated jaw position', () => {
    const expression = estimateDragonExpression(resultFor(0.105, 0.027, 0.14, 0.03), calibration)
    expect(expression.jawOpen).toBeGreaterThan(0.45)
    expect(expression.jawOpen).toBeLessThan(0.7)
  })

  it('reserves the largest jaw travel for a genuinely wide opening', () => {
    const normal = estimateDragonExpression(resultFor(0.105, 0.027, 0.14, 0.03), calibration)
    const wide = estimateDragonExpression(resultFor(0.14, 0.033, 0.14, 0.03), calibration)
    expect(wide.jawOpen).toBeGreaterThan(normal.jawOpen + 0.2)
    expect(wide.jawOpen).toBeLessThanOrEqual(0.82)
  })

  it('maps a calibrated eye closure to a decisive blink', () => {
    const expression = estimateDragonExpression(resultFor(0.04, 0.012, 0.045, 0.72), calibration)
    expect(expression.blinkLeft).toBeGreaterThan(0.75)
    expect(expression.blinkRight).toBeGreaterThan(0.75)
  })

  it('keeps a short natural blink visible even below the guided closed-eye score', () => {
    const expression = estimateDragonExpression(resultFor(0.04, 0.012, 0.125, 0.25), calibration)
    expect(expression.blinkLeft).toBeGreaterThan(0.15)
    expect(expression.blinkRight).toBeGreaterThan(0.15)
  })
})

describe('smoothDragonExpression', () => {
  it('rejects weak neutral jitter', () => {
    const next = { ...NEUTRAL_DRAGON_EXPRESSION, jawOpen: 0.08, blinkLeft: 0.08 }
    expect(smoothDragonExpression(NEUTRAL_DRAGON_EXPRESSION, next)).toEqual(NEUTRAL_DRAGON_EXPRESSION)
  })

  it('opens and closes quickly enough for articulated speech', () => {
    const open = smoothDragonExpression(
      NEUTRAL_DRAGON_EXPRESSION,
      { ...NEUTRAL_DRAGON_EXPRESSION, jawOpen: 0.65 },
    )
    const consonant = smoothDragonExpression(
      open,
      { ...NEUTRAL_DRAGON_EXPRESSION, jawOpen: 0.1 },
    )
    expect(open.jawOpen).toBeGreaterThan(0.45)
    expect(consonant.jawOpen).toBeLessThan(open.jawOpen * 0.25)
  })

  it('does not suppress a moderate natural blink', () => {
    const blink = smoothDragonExpression(
      NEUTRAL_DRAGON_EXPRESSION,
      { ...NEUTRAL_DRAGON_EXPRESSION, blinkLeft: 0.18, blinkRight: 0.18 },
    )
    expect(blink.blinkLeft).toBeGreaterThan(0.17)
    expect(blink.blinkRight).toBeGreaterThan(0.17)
  })
})