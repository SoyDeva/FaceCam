import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import {
  estimateDragonExpression,
  NEUTRAL_DRAGON_EXPRESSION,
  smoothDragonExpression,
} from './dragonExpressions'

function resultWithScores(scores: Record<string, number>): FaceLandmarkerResult {
  return {
    faceLandmarks: [],
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

describe('estimateDragonExpression', () => {
  it('maps jaw, blink, gaze and smile blendshapes', () => {
    const expression = estimateDragonExpression(resultWithScores({
      jawOpen: 0.8,
      eyeBlinkLeft: 0.9,
      eyeBlinkRight: 0.15,
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

    expect(expression.jawOpen).toBeGreaterThan(0.9)
    expect(expression.blinkLeft).toBeGreaterThan(0.9)
    expect(expression.blinkRight).toBeLessThan(0.1)
    expect(expression.gazeX).toBeLessThan(0)
    expect(expression.gazeY).toBeGreaterThan(0)
    expect(expression.smile).toBeGreaterThan(0.8)
    expect(expression.browRaise).toBeGreaterThan(0.7)
  })

  it('returns a neutral expression without blendshapes', () => {
    expect(estimateDragonExpression(null)).toEqual(NEUTRAL_DRAGON_EXPRESSION)
  })
})

describe('smoothDragonExpression', () => {
  it('responds faster to blinking than to jaw movement', () => {
    const next = {
      ...NEUTRAL_DRAGON_EXPRESSION,
      jawOpen: 1,
      blinkLeft: 1,
    }
    const smoothed = smoothDragonExpression(NEUTRAL_DRAGON_EXPRESSION, next, 0.25)

    expect(smoothed.blinkLeft).toBeGreaterThan(smoothed.jawOpen)
    expect(smoothed.jawOpen).toBeCloseTo(0.25)
  })
})
