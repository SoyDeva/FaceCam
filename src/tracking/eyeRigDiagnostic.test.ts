import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import {
  eyeRigDiagnosticFrame,
  overrideEyeBlinkScores,
} from './eyeRigDiagnostic'

function resultWithBlinkScores(left: number, right: number): FaceLandmarkerResult {
  return {
    faceLandmarks: [[]],
    faceBlendshapes: [{
      categories: [
        { categoryName: 'eyeBlinkLeft', displayName: '', index: 0, score: left },
        { categoryName: 'eyeBlinkRight', displayName: '', index: 1, score: right },
        { categoryName: 'jawOpen', displayName: '', index: 2, score: 0.37 },
      ],
      headIndex: 0,
      headName: '',
    }],
    facialTransformationMatrixes: [],
  } as unknown as FaceLandmarkerResult
}

describe('eyeRigDiagnosticFrame', () => {
  it('forces both eyes, then each eye independently, without touching the jaw', () => {
    expect(eyeRigDiagnosticFrame(100)).toMatchObject({ left: 0, right: 0 })
    expect(eyeRigDiagnosticFrame(700)).toMatchObject({ left: 1, right: 1 })
    expect(eyeRigDiagnosticFrame(1_900)).toMatchObject({ left: 1, right: 0 })
    expect(eyeRigDiagnosticFrame(3_100)).toMatchObject({ left: 0, right: 1 })
    expect(eyeRigDiagnosticFrame(4_200)).toBeNull()
  })
})

describe('overrideEyeBlinkScores', () => {
  it('replaces only the two blink channels', () => {
    const result = overrideEyeBlinkScores(resultWithBlinkScores(0.1, 0.2), 1, 0)
    const scores = new Map(
      result.faceBlendshapes[0]?.categories.map((category) => [category.categoryName, category.score]),
    )

    expect(scores.get('eyeBlinkLeft')).toBe(1)
    expect(scores.get('eyeBlinkRight')).toBe(0)
    expect(scores.get('jawOpen')).toBe(0.37)
  })
})
