import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { beforeEach, describe, expect, it } from 'vitest'
import { NEUTRAL_DRAGON_EXPRESSION } from './dragonExpressions'
import {
  estimateLiveAutoDragonExpression,
  resetLiveAutoExpressionCalibration,
  smoothLiveAutoDragonExpression,
} from './liveAutoExpression'

function landmark(x: number, y: number, z = 0): NormalizedLandmark {
  return { x, y, z, visibility: 1 }
}

function mouthFrame(jawOpen: number, mouthGap: number): FaceLandmarkerResult {
  const landmarks = Array.from({ length: 478 }, () => landmark(0.5, 0.5))
  landmarks[10] = landmark(0.5, 0.2)
  landmarks[152] = landmark(0.5, 0.8)
  landmarks[61] = landmark(0.42, 0.56)
  landmarks[291] = landmark(0.58, 0.56)
  landmarks[13] = landmark(0.5, 0.56 - mouthGap / 2)
  landmarks[14] = landmark(0.5, 0.56 + mouthGap / 2)

  const setEye = (
    outer: number,
    inner: number,
    upper: readonly [number, number, number],
    lower: readonly [number, number, number],
    centerX: number,
  ) => {
    const width = 0.08
    const gap = 0.386 * width
    landmarks[outer] = landmark(centerX - width / 2, 0.42)
    landmarks[inner] = landmark(centerX + width / 2, 0.42)
    for (let index = 0; index < 3; index += 1) {
      const x = centerX + (index - 1) * 0.01
      landmarks[upper[index]] = landmark(x, 0.42 - gap / 2)
      landmarks[lower[index]] = landmark(x, 0.42 + gap / 2)
    }
  }

  setEye(33, 133, [159, 160, 158], [145, 144, 153], 0.39)
  setEye(362, 263, [386, 385, 387], [374, 380, 373], 0.61)

  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [{
      categories: [
        { categoryName: 'jawOpen', score: jawOpen, index: 0, displayName: '' },
        { categoryName: 'eyeBlinkLeft', score: 0.34, index: 1, displayName: '' },
        { categoryName: 'eyeBlinkRight', score: 0.30, index: 2, displayName: '' },
        { categoryName: 'mouthClose', score: 0.004, index: 3, displayName: '' },
      ],
      headIndex: 0,
      headName: '',
    }],
    facialTransformationMatrixes: [],
  } as unknown as FaceLandmarkerResult
}

describe('natural live expression motion', () => {
  beforeEach(() => resetLiveAutoExpressionCalibration())

  it('compresses very large live mouth readings instead of saturating the rigid jaw', () => {
    for (let index = 0; index < 4; index += 1) {
      estimateLiveAutoDragonExpression(mouthFrame(0.002, 0.004))
    }

    const ordinary = estimateLiveAutoDragonExpression(mouthFrame(0.11, 0.025))
    const capturedWide = estimateLiveAutoDragonExpression(mouthFrame(0.578, 0.088))

    expect(ordinary.jawOpen).toBeGreaterThan(0.4)
    expect(ordinary.jawOpen).toBeLessThan(0.6)
    expect(capturedWide.jawOpen).toBeGreaterThan(ordinary.jawOpen)
    expect(capturedWide.jawOpen).toBeLessThanOrEqual(0.68)
  })

  it('closes a blink quickly but not in a one-frame snap, then reopens more gently', () => {
    const blinkTarget = {
      ...NEUTRAL_DRAGON_EXPRESSION,
      blinkLeft: 1,
      blinkRight: 1,
    }

    const closing1 = smoothLiveAutoDragonExpression(NEUTRAL_DRAGON_EXPRESSION, blinkTarget)
    const closing2 = smoothLiveAutoDragonExpression(closing1, blinkTarget)
    const opening1 = smoothLiveAutoDragonExpression(closing2, NEUTRAL_DRAGON_EXPRESSION)
    const opening2 = smoothLiveAutoDragonExpression(opening1, NEUTRAL_DRAGON_EXPRESSION)

    expect(closing1.blinkLeft).toBeGreaterThan(0.75)
    expect(closing1.blinkLeft).toBeLessThan(0.9)
    expect(closing2.blinkLeft).toBeGreaterThan(closing1.blinkLeft)
    expect(opening1.blinkLeft).toBeLessThan(closing2.blinkLeft)
    expect(opening1.blinkLeft).toBeGreaterThan(0.35)
    expect(opening2.blinkLeft).toBeLessThan(opening1.blinkLeft)
    expect(closing1.blinkLeft).toBeCloseTo(closing1.blinkRight)
    expect(opening1.blinkLeft).toBeCloseTo(opening1.blinkRight)
  })

  it('keeps an intentional wink independent while harmonizing a bilateral blink', () => {
    const wink = smoothLiveAutoDragonExpression(NEUTRAL_DRAGON_EXPRESSION, {
      ...NEUTRAL_DRAGON_EXPRESSION,
      blinkLeft: 1,
      blinkRight: 0,
    })
    expect(wink.blinkLeft).toBeGreaterThan(0.75)
    expect(wink.blinkRight).toBe(0)

    const bilateral = smoothLiveAutoDragonExpression(NEUTRAL_DRAGON_EXPRESSION, {
      ...NEUTRAL_DRAGON_EXPRESSION,
      blinkLeft: 0.95,
      blinkRight: 0.7,
    })
    expect(Math.abs(bilateral.blinkLeft - bilateral.blinkRight)).toBeLessThan(0.18)
  })
})
