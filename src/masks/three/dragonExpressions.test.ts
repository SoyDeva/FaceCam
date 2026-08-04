import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import {
  estimateDragonExpression,
  NEUTRAL_DRAGON_EXPRESSION,
  smoothDragonExpression,
} from './dragonExpressions'

function baseLandmarks(): NormalizedLandmark[] {
  return Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
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
    expect(expression.blinkRight).toBeLessThan(0.2)
    expect(expression.gazeX).toBeLessThan(0)
    expect(expression.gazeY).toBeGreaterThan(0)
    expect(expression.smile).toBeGreaterThan(0.8)
    expect(expression.browRaise).toBeGreaterThan(0.7)
  })

  it('responds to small jaw blendshape values used during speech', () => {
    const expression = estimateDragonExpression(resultWithScores({ jawOpen: 0.18 }))
    expect(expression.jawOpen).toBeGreaterThan(0.2)
  })

  it('uses lip geometry when the blendshape is weak', () => {
    const landmarks = baseLandmarks()
    landmarks[10] = { x: 0.5, y: 0.25, z: 0 }
    landmarks[152] = { x: 0.5, y: 0.76, z: 0 }
    landmarks[61] = { x: 0.42, y: 0.56, z: 0 }
    landmarks[291] = { x: 0.58, y: 0.56, z: 0 }
    landmarks[13] = { x: 0.5, y: 0.535, z: 0 }
    landmarks[14] = { x: 0.5, y: 0.595, z: 0 }

    const expression = estimateDragonExpression(resultWithScores({ jawOpen: 0.02 }, landmarks))
    expect(expression.jawOpen).toBeGreaterThan(0.45)
  })

  it('detects a closed left eyelid from landmarks', () => {
    const landmarks = baseLandmarks()
    landmarks[33] = { x: 0.35, y: 0.43, z: 0 }
    landmarks[133] = { x: 0.45, y: 0.43, z: 0 }
    landmarks[159] = { x: 0.4, y: 0.429, z: 0 }
    landmarks[145] = { x: 0.4, y: 0.433, z: 0 }
    landmarks[160] = { x: 0.39, y: 0.429, z: 0 }
    landmarks[144] = { x: 0.39, y: 0.433, z: 0 }

    const expression = estimateDragonExpression(resultWithScores({}, landmarks))
    expect(expression.blinkLeft).toBeGreaterThan(0.85)
  })

  it('returns a neutral expression without tracking data', () => {
    expect(estimateDragonExpression(null)).toEqual(NEUTRAL_DRAGON_EXPRESSION)
  })
})

describe('smoothDragonExpression', () => {
  it('responds faster to speech and blinking than the old generic smoothing', () => {
    const next = {
      ...NEUTRAL_DRAGON_EXPRESSION,
      jawOpen: 1,
      blinkLeft: 1,
    }
    const smoothed = smoothDragonExpression(NEUTRAL_DRAGON_EXPRESSION, next, 0.25)

    expect(smoothed.blinkLeft).toBeGreaterThan(smoothed.jawOpen)
    expect(smoothed.jawOpen).toBeGreaterThan(0.65)
    expect(smoothed.blinkLeft).toBeGreaterThan(0.85)
  })

  it('closes the jaw quickly enough to articulate speech', () => {
    const previous = { ...NEUTRAL_DRAGON_EXPRESSION, jawOpen: 1 }
    const smoothed = smoothDragonExpression(previous, NEUTRAL_DRAGON_EXPRESSION, 0.25)
    expect(smoothed.jawOpen).toBeLessThan(0.55)
  })
})
