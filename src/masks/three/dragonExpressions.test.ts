import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import {
  estimateDragonExpression,
  NEUTRAL_DRAGON_EXPRESSION,
  smoothDragonExpression,
} from './dragonExpressions'

function landmark(x: number, y: number, z = 0): NormalizedLandmark {
  return { x, y, z, visibility: 1 }
}

function baseLandmarks(): NormalizedLandmark[] {
  return Array.from({ length: 478 }, () => landmark(0.5, 0.5))
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

  it('responds to small jaw values used during normal speech', () => {
    const expression = estimateDragonExpression(resultWithScores({ jawOpen: 0.06 }))
    expect(expression.jawOpen).toBeGreaterThan(0.3)
  })

  it('uses small lip separation when the jaw blendshape is weak', () => {
    const landmarks = baseLandmarks()
    landmarks[10] = landmark(0.5, 0.25)
    landmarks[152] = landmark(0.5, 0.76)
    landmarks[61] = landmark(0.42, 0.56)
    landmarks[291] = landmark(0.58, 0.56)
    landmarks[0] = landmark(0.5, 0.548)
    landmarks[17] = landmark(0.5, 0.572)
    landmarks[13] = landmark(0.5, 0.55)
    landmarks[14] = landmark(0.5, 0.57)

    const expression = estimateDragonExpression(resultWithScores({ jawOpen: 0.008 }, landmarks))
    expect(expression.jawOpen).toBeGreaterThan(0.2)
  })

  it('responds decisively to a modest blink score', () => {
    const expression = estimateDragonExpression(resultWithScores({ eyeBlinkLeft: 0.12 }))
    expect(expression.blinkLeft).toBeGreaterThan(0.5)
  })

  it('detects a closed left eyelid from landmarks', () => {
    const landmarks = baseLandmarks()
    landmarks[33] = landmark(0.35, 0.43)
    landmarks[133] = landmark(0.45, 0.43)
    landmarks[159] = landmark(0.4, 0.429)
    landmarks[145] = landmark(0.4, 0.433)
    landmarks[160] = landmark(0.39, 0.429)
    landmarks[144] = landmark(0.39, 0.433)
    landmarks[158] = landmark(0.41, 0.429)
    landmarks[153] = landmark(0.41, 0.433)

    const expression = estimateDragonExpression(resultWithScores({}, landmarks))
    expect(expression.blinkLeft).toBeGreaterThan(0.9)
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
    expect(smoothed.jawOpen).toBeGreaterThan(0.8)
    expect(smoothed.blinkLeft).toBeGreaterThan(0.95)
  })

  it('closes the jaw quickly enough to articulate consecutive syllables', () => {
    const previous = { ...NEUTRAL_DRAGON_EXPRESSION, jawOpen: 1 }
    const smoothed = smoothDragonExpression(previous, NEUTRAL_DRAGON_EXPRESSION, 0.25)
    expect(smoothed.jawOpen).toBeLessThan(0.35)
  })
})
