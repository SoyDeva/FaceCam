import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import { estimateDragonExpression } from './dragonExpressions'

function landmark(x: number, y: number, z = 0): NormalizedLandmark {
  return { x, y, z, visibility: 1 }
}

function resultWithEyeOpening(leftOpening: number, rightOpening: number): FaceLandmarkerResult {
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
        { categoryName: 'eyeBlinkLeft', score: 0, index: 0, displayName: '' },
        { categoryName: 'eyeBlinkRight', score: 0, index: 1, displayName: '' },
      ],
      headIndex: 0,
      headName: '',
    }],
    facialTransformationMatrixes: [],
  } as unknown as FaceLandmarkerResult
}

describe('geometry-only live blink fallback', () => {
  it('closes both GLB eye channels without blendshape support or calibration', () => {
    const expression = estimateDragonExpression(resultWithEyeOpening(0.045, 0.045), null)
    expect(expression.blinkLeft).toBeGreaterThan(0.9)
    expect(expression.blinkRight).toBeGreaterThan(0.9)
  })

  it('keeps open eyes neutral and preserves independent winks', () => {
    const open = estimateDragonExpression(resultWithEyeOpening(0.14, 0.14), null)
    const wink = estimateDragonExpression(resultWithEyeOpening(0.045, 0.14), null)

    expect(open.blinkLeft).toBe(0)
    expect(open.blinkRight).toBe(0)
    expect(wink.blinkLeft).toBeGreaterThan(0.9)
    expect(wink.blinkRight).toBe(0)
  })
})
