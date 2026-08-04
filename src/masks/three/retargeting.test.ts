import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import { DragonExpressionSmoother, retargetFaceExpression } from './retargeting'

function resultWithScores(scores: Record<string, number>): FaceLandmarkerResult {
  return {
    faceLandmarks: [],
    facialTransformationMatrixes: [],
    faceBlendshapes: [
      {
        categories: Object.entries(scores).map(([categoryName, score], index) => ({
          categoryName,
          score,
          index,
          displayName: '',
        })),
        headIndex: -1,
        headName: '',
      },
    ],
  } as FaceLandmarkerResult
}

describe('retargetFaceExpression', () => {
  it('maps MediaPipe coefficients into canonical dragon targets', () => {
    const frame = retargetFaceExpression(resultWithScores({
      eyeBlinkLeft: 0.8,
      jawOpen: 1,
      mouthSmileLeft: 1,
      noseSneerLeft: 0.6,
      noseSneerRight: 0.4,
    }))

    expect(frame.blinkLeft).toBeCloseTo(0.8)
    expect(frame.jawOpen).toBeCloseTo(0.9)
    expect(frame.mouthSmileLeft).toBeCloseTo(0.45)
    expect(frame.nostrilFlare).toBeGreaterThan(0.4)
  })

  it('returns a neutral frame without tracking', () => {
    const frame = retargetFaceExpression(null)
    expect(Object.values(frame).every((value) => value === 0)).toBe(true)
  })
})

describe('DragonExpressionSmoother', () => {
  it('smooths ordinary expressions while keeping blink response fast', () => {
    const smoother = new DragonExpressionSmoother()
    const target = retargetFaceExpression(resultWithScores({
      eyeBlinkLeft: 1,
      jawOpen: 1,
    }))

    const frame = smoother.update(target, 16)
    expect(frame.blinkLeft).toBeGreaterThan(frame.jawOpen)
    expect(frame.blinkLeft).toBeLessThanOrEqual(1)
  })
})
