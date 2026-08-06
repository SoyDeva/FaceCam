import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'

export interface EyeRigDiagnosticFrame {
  left: number
  right: number
  label: string
}

export interface EyeSignalSnapshot {
  rawLeft: number
  rawRight: number
  openingLeft: number | null
  openingRight: number | null
}

const LEFT_EYE = [33, 133, 159, 145, 160, 144, 158, 153] as const
const RIGHT_EYE = [362, 263, 386, 374, 385, 380, 387, 373] as const

function distance2d(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function eyeOpening(
  landmarks: NormalizedLandmark[],
  indices: readonly [number, number, number, number, number, number, number, number],
): number | null {
  const [outerIndex, innerIndex, upperAIndex, lowerAIndex, upperBIndex, lowerBIndex, upperCIndex, lowerCIndex] = indices
  const outer = landmarks[outerIndex]
  const inner = landmarks[innerIndex]
  const upperA = landmarks[upperAIndex]
  const lowerA = landmarks[lowerAIndex]
  const upperB = landmarks[upperBIndex]
  const lowerB = landmarks[lowerBIndex]
  const upperC = landmarks[upperCIndex]
  const lowerC = landmarks[lowerCIndex]
  if (!outer || !inner || !upperA || !lowerA || !upperB || !lowerB || !upperC || !lowerC) return null

  const width = distance2d(outer, inner)
  if (!Number.isFinite(width) || width < 0.012) return null

  return (
    distance2d(upperA, lowerA)
    + distance2d(upperB, lowerB)
    + distance2d(upperC, lowerC)
  ) / (3 * width)
}

function rawScore(result: FaceLandmarkerResult, name: string): number {
  return result.faceBlendshapes[0]?.categories.find((category) => category.categoryName === name)?.score ?? 0
}

export function eyeRigDiagnosticFrame(elapsedMs: number): EyeRigDiagnosticFrame | null {
  if (elapsedMs < 500) return { left: 0, right: 0, label: 'ABRE AMBOS' }
  if (elapsedMs < 1_250) return { left: 1, right: 1, label: 'CIERRA AMBOS' }
  if (elapsedMs < 1_700) return { left: 0, right: 0, label: 'ABRE AMBOS' }
  if (elapsedMs < 2_450) return { left: 1, right: 0, label: 'CIERRA IZQUIERDO' }
  if (elapsedMs < 2_900) return { left: 0, right: 0, label: 'ABRE AMBOS' }
  if (elapsedMs < 3_650) return { left: 0, right: 1, label: 'CIERRA DERECHO' }
  if (elapsedMs < 4_100) return { left: 0, right: 0, label: 'ABRE AMBOS' }
  return null
}

export function eyeSignalSnapshot(result: FaceLandmarkerResult): EyeSignalSnapshot {
  const landmarks = result.faceLandmarks[0]
  return {
    rawLeft: rawScore(result, 'eyeBlinkLeft'),
    rawRight: rawScore(result, 'eyeBlinkRight'),
    openingLeft: landmarks ? eyeOpening(landmarks, LEFT_EYE) : null,
    openingRight: landmarks ? eyeOpening(landmarks, RIGHT_EYE) : null,
  }
}

export function overrideEyeBlinkScores(
  result: FaceLandmarkerResult,
  left: number,
  right: number,
): FaceLandmarkerResult {
  const source = result.faceBlendshapes[0]
  const categories = [...(source?.categories ?? [])]

  const setScore = (name: string, value: number) => {
    const index = categories.findIndex((category) => category.categoryName === name)
    if (index >= 0) {
      categories[index] = { ...categories[index], score: value }
      return
    }
    categories.push({
      categoryName: name,
      displayName: '',
      index: categories.length,
      score: value,
    })
  }

  setScore('eyeBlinkLeft', left)
  setScore('eyeBlinkRight', right)

  return {
    ...result,
    faceBlendshapes: [{
      categories,
      headIndex: source?.headIndex ?? 0,
      headName: source?.headName ?? '',
    }],
  }
}
