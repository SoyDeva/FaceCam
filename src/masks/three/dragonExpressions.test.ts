import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  estimateDragonExpression,
  NEUTRAL_DRAGON_EXPRESSION,
  resetAdaptiveExpressionCalibration,
  smoothDragonExpression,
} from './dragonExpressions'

function landmark(x: number, y: number, z = 0): NormalizedLandmark {
  return { x, y, z, visibility: 1 }
}

function neutralFaceLandmarks(): NormalizedLandmark[] {
  const landmarks = Array.from({ length: 478 }, () => landmark(0.5, 0.5))
  landmarks[10] = landmark(0.5, 0.25)
  landmarks[152] = landmark(0.5, 0.76)
  landmarks[61] = landmark(0.42, 0.56)
  landmarks[291] = landmark(0.58, 0.56)
  landmarks[0] = landmark(0.5, 0.552)
  landmarks[17] = landmark(0.5, 0.562)
  landmarks[13] = landmark(0.5, 0.555)
  landmarks[14] = landmark(0.5, 0.559)

  landmarks[33] = landmark(0.35, 0.43)
  landmarks[133] = landmark(0.45, 0.43)
  landmarks[159] = landmark(0.4, 0.42)
  landmarks[145] = landmark(0.4, 0.44)
  landmarks[160] = landmark(0.39, 0.421)
  landmarks[144] = landmark(0.39, 0.439)
  landmarks[158] = landmark(0.41, 0.421)
  landmarks[153] = landmark(0.41, 0.439)

  landmarks[362] = landmark(0.55, 0.43)
  landmarks[263] = landmark(0.65, 0.43)
  landmarks[386] = landmark(0.6, 0.42)
  landmarks[374] = landmark(0.6, 0.44)
  landmarks[385] = landmark(0.59, 0.421)
  landmarks[380] = landmark(0.59, 0.439)
  landmarks[387] = landmark(0.61, 0.421)
  landmarks[373] = landmark(0.61, 0.439)
  return landmarks
}

function resultWithScores(
  scores: Record<string, number>,
  landmarks: NormalizedLandmark[] = [],
): FaceLandmarkerResult {
  return {
    faceLandmarks: landmarks.length ? [landmarks] : [],
    faceBlendshapes: [{
      categories: Object.entries(scores).map(([categoryName, score], index) => ({
        categoryName,
        score,
        index,
        displayName: '',
      })),
      headIndex: 0,
      headName: '',
    }],
    facialTransformationMatrixes: [],
  } as unknown as FaceLandmarkerResult
}

function bootstrapNeutral(scores: Record<string, number> = {}): void {
  for (let frame = 0; frame < 12; frame += 1) {
    estimateDragonExpression(resultWithScores(scores, neutralFaceLandmarks()))
  }
}

beforeEach(() => {
  resetAdaptiveExpressionCalibration()
})

describe('estimateDragonExpression', () => {
  it('maps jaw, blink, gaze and smile blendshapes without landmarks', () => {
    const expression = estimateDragonExpression(resultWithScores({
      jawOpen: 0.8,
      eyeBlinkLeft: 0.9,
      eyeBlinkRight: 0.015,
      eyeLookInLeft: 0.8,
      eyeLookOutRight: 0.8,
      eyeLookDownLeft: 0.6,
      eyeLookDownRight: 0.6,
      mouthSmileLeft: 0.7,
      mouthSmileRight: 0.7,
      browInnerUp: 0.6,
      browOuterUpLeft: 0.6,
      browOuterUpRight: 0.6,
    }))

    expect(expression.jawOpen).toBeGreaterThan(0.95)
    expect(expression.blinkLeft).toBeGreaterThan(0.95)
    expect(expression.blinkRight).toBeLessThan(0.1)
    expect(expression.gazeX).toBeLessThan(0)
    expect(expression.gazeY).toBeGreaterThan(0)
    expect(expression.smile).toBeGreaterThan(0.8)
    expect(expression.browRaise).toBeGreaterThan(0.7)
  })

  it('uses most of the jaw morph during ordinary blendshape-only speech', () => {
    const expression = estimateDragonExpression(resultWithScores({ jawOpen: 0.06 }))
    expect(expression.jawOpen).toBeGreaterThan(0.65)
  })

  it('keeps a noisy mobile neutral mouth closed after bootstrap', () => {
    bootstrapNeutral({ jawOpen: 0.08, eyeBlinkLeft: 0.04, eyeBlinkRight: 0.04 })
    const expression = estimateDragonExpression(resultWithScores(
      { jawOpen: 0.08, eyeBlinkLeft: 0.04, eyeBlinkRight: 0.04 },
      neutralFaceLandmarks(),
    ))
    expect(expression.jawOpen).toBe(0)
    expect(expression.blinkLeft).toBeLessThan(0.05)
    expect(expression.blinkRight).toBeLessThan(0.05)
  })

  it('responds to speech relative to a noisy mobile baseline', () => {
    bootstrapNeutral({ jawOpen: 0.08 })
    const landmarks = neutralFaceLandmarks()
    landmarks[0] = landmark(0.5, 0.545)
    landmarks[17] = landmark(0.5, 0.575)
    landmarks[13] = landmark(0.5, 0.548)
    landmarks[14] = landmark(0.5, 0.572)

    const expression = estimateDragonExpression(
      resultWithScores({ jawOpen: 0.115 }, landmarks),
    )
    expect(expression.jawOpen).toBeGreaterThan(0.35)
  })

  it('detects a closed eyelid relative to the calibrated open eye', () => {
    bootstrapNeutral({ eyeBlinkLeft: 0.04, eyeBlinkRight: 0.04 })
    const landmarks = neutralFaceLandmarks()
    landmarks[159] = landmark(0.4, 0.429)
    landmarks[145] = landmark(0.4, 0.433)
    landmarks[160] = landmark(0.39, 0.429)
    landmarks[144] = landmark(0.39, 0.433)
    landmarks[158] = landmark(0.41, 0.429)
    landmarks[153] = landmark(0.41, 0.433)

    const expression = estimateDragonExpression(
      resultWithScores({ eyeBlinkLeft: 0.09, eyeBlinkRight: 0.04 }, landmarks),
    )
    expect(expression.blinkLeft).toBeGreaterThan(0.9)
    expect(expression.blinkRight).toBeLessThan(0.15)
  })

  it('does not recalibrate repeatedly from the same video result object', () => {
    bootstrapNeutral({ jawOpen: 0.05 })
    const landmarks = neutralFaceLandmarks()
    landmarks[13] = landmark(0.5, 0.548)
    landmarks[14] = landmark(0.5, 0.572)
    const result = resultWithScores({ jawOpen: 0.09 }, landmarks)
    const first = estimateDragonExpression(result)
    const repeated = estimateDragonExpression(result)
    expect(repeated).toEqual(first)
  })

  it('returns a neutral expression without tracking data', () => {
    expect(estimateDragonExpression(null)).toEqual(NEUTRAL_DRAGON_EXPRESSION)
  })
})

describe('smoothDragonExpression', () => {
  it('responds nearly immediately to speech and blinking', () => {
    const next = {
      ...NEUTRAL_DRAGON_EXPRESSION,
      jawOpen: 1,
      blinkLeft: 1,
    }
    const smoothed = smoothDragonExpression(NEUTRAL_DRAGON_EXPRESSION, next, 0.25)

    expect(smoothed.blinkLeft).toBeGreaterThan(smoothed.jawOpen)
    expect(smoothed.jawOpen).toBeGreaterThan(0.85)
    expect(smoothed.blinkLeft).toBeGreaterThan(0.97)
  })

  it('closes the jaw quickly enough to articulate consecutive syllables', () => {
    const previous = { ...NEUTRAL_DRAGON_EXPRESSION, jawOpen: 1 }
    const smoothed = smoothDragonExpression(previous, NEUTRAL_DRAGON_EXPRESSION, 0.25)
    expect(smoothed.jawOpen).toBeLessThan(0.25)
  })
})
