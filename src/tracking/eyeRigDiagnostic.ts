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
  jawOpen: number
  mouthClose: number
  mouthHeight: number | null
  mouthGapToSpan: number | null
  blendshapeCount: number
}

const LEFT_EYE = [33, 133, 159, 145, 160, 144, 158, 153] as const
const RIGHT_EYE = [362, 263, 386, 374, 385, 380, 387, 373] as const

const FACE = {
  forehead: 10,
  chin: 152,
  mouthLeft: 61,
  mouthRight: 291,
  upperLipInner: 13,
  lowerLipInner: 14,
  upperLipOuter: 0,
  lowerLipOuter: 17,
} as const

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

function mouthGeometry(
  landmarks: NormalizedLandmark[],
): { mouthHeight: number | null; mouthGapToSpan: number | null } {
  const forehead = landmarks[FACE.forehead]
  const chin = landmarks[FACE.chin]
  const mouthLeft = landmarks[FACE.mouthLeft]
  const mouthRight = landmarks[FACE.mouthRight]
  const upperInner = landmarks[FACE.upperLipInner]
  const lowerInner = landmarks[FACE.lowerLipInner]
  const upperOuter = landmarks[FACE.upperLipOuter]
  const lowerOuter = landmarks[FACE.lowerLipOuter]
  if (!forehead || !chin || !mouthLeft || !mouthRight || !upperInner || !lowerInner || !upperOuter || !lowerOuter) {
    return { mouthHeight: null, mouthGapToSpan: null }
  }

  const faceHeight = distance2d(forehead, chin)
  const mouthSpan = distance2d(mouthLeft, mouthRight)
  if (!Number.isFinite(faceHeight) || !Number.isFinite(mouthSpan) || faceHeight < 0.08 || mouthSpan < 0.025) {
    return { mouthHeight: null, mouthGapToSpan: null }
  }

  const innerGap = distance2d(upperInner, lowerInner)
  const outerGap = distance2d(upperOuter, lowerOuter)
  const mouthGap = Math.max(innerGap, outerGap * 0.74)

  return {
    mouthHeight: mouthGap / faceHeight,
    mouthGapToSpan: mouthGap / mouthSpan,
  }
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
  const geometry = landmarks
    ? mouthGeometry(landmarks)
    : { mouthHeight: null, mouthGapToSpan: null }
  const categories = result.faceBlendshapes[0]?.categories ?? []

  return {
    rawLeft: rawScore(result, 'eyeBlinkLeft'),
    rawRight: rawScore(result, 'eyeBlinkRight'),
    openingLeft: landmarks ? eyeOpening(landmarks, LEFT_EYE) : null,
    openingRight: landmarks ? eyeOpening(landmarks, RIGHT_EYE) : null,
    jawOpen: rawScore(result, 'jawOpen'),
    mouthClose: rawScore(result, 'mouthClose'),
    mouthHeight: geometry.mouthHeight,
    mouthGapToSpan: geometry.mouthGapToSpan,
    blendshapeCount: categories.length,
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
