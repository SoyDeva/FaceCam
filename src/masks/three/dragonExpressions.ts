import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'

export interface DragonExpressionState {
  jawOpen: number
  blinkLeft: number
  blinkRight: number
  gazeX: number
  gazeY: number
  smile: number
  browRaise: number
}

export const NEUTRAL_DRAGON_EXPRESSION: DragonExpressionState = {
  jawOpen: 0,
  blinkLeft: 0,
  blinkRight: 0,
  gazeX: 0,
  gazeY: 0,
  smile: 0,
  browRaise: 0,
}

const LANDMARK = {
  forehead: 10,
  chin: 152,
  mouthLeft: 61,
  mouthRight: 291,
  upperLip: 13,
  lowerLip: 14,
  leftEyeOuter: 33,
  leftEyeInner: 133,
  leftEyeUpperA: 159,
  leftEyeLowerA: 145,
  leftEyeUpperB: 160,
  leftEyeLowerB: 144,
  rightEyeInner: 362,
  rightEyeOuter: 263,
  rightEyeUpperA: 386,
  rightEyeLowerA: 374,
  rightEyeUpperB: 385,
  rightEyeLowerB: 380,
} as const

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0))
  return amount * amount * (3 - 2 * amount)
}

function lerp(previous: number, next: number, alpha: number): number {
  return previous + (next - previous) * alpha
}

function distance2d(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function blendshapeMap(result: FaceLandmarkerResult | null): Map<string, number> {
  const categories = result?.faceBlendshapes[0]?.categories ?? []
  return new Map(categories.map((category) => [category.categoryName, category.score]))
}

function score(scores: Map<string, number>, name: string): number {
  return clamp(scores.get(name) ?? 0)
}

function mouthLandmarkSignal(result: FaceLandmarkerResult | null): number {
  const landmarks = result?.faceLandmarks[0]
  if (!landmarks) return 0

  const upper = landmarks[LANDMARK.upperLip]
  const lower = landmarks[LANDMARK.lowerLip]
  const forehead = landmarks[LANDMARK.forehead]
  const chin = landmarks[LANDMARK.chin]
  const mouthLeft = landmarks[LANDMARK.mouthLeft]
  const mouthRight = landmarks[LANDMARK.mouthRight]
  if (!upper || !lower || !forehead || !chin || !mouthLeft || !mouthRight) return 0

  const faceHeight = distance2d(forehead, chin)
  const mouthWidth = distance2d(mouthLeft, mouthRight)
  if (faceHeight < 0.08 || mouthWidth < 0.025) return 0

  const gap = distance2d(upper, lower)
  const heightRatio = gap / faceHeight
  const widthRatio = gap / mouthWidth
  const heightSignal = smoothstep(0.0045, 0.105, heightRatio)
  const widthSignal = smoothstep(0.012, 0.42, widthRatio)
  return clamp(heightSignal * 0.72 + widthSignal * 0.28)
}

function eyeLandmarkBlink(
  result: FaceLandmarkerResult | null,
  indices: readonly [number, number, number, number, number, number],
): number {
  const landmarks = result?.faceLandmarks[0]
  if (!landmarks) return 0

  const [outerIndex, innerIndex, upperAIndex, lowerAIndex, upperBIndex, lowerBIndex] = indices
  const outer = landmarks[outerIndex]
  const inner = landmarks[innerIndex]
  const upperA = landmarks[upperAIndex]
  const lowerA = landmarks[lowerAIndex]
  const upperB = landmarks[upperBIndex]
  const lowerB = landmarks[lowerBIndex]
  if (!outer || !inner || !upperA || !lowerA || !upperB || !lowerB) return 0

  const width = distance2d(outer, inner)
  if (width < 0.012) return 0

  const opening = (distance2d(upperA, lowerA) + distance2d(upperB, lowerB)) / (2 * width)
  return 1 - smoothstep(0.055, 0.235, opening)
}

export function estimateDragonExpression(
  result: FaceLandmarkerResult | null,
): DragonExpressionState {
  const scores = blendshapeMap(result)
  const landmarksAvailable = Boolean(result?.faceLandmarks[0])
  if (!scores.size && !landmarksAvailable) return { ...NEUTRAL_DRAGON_EXPRESSION }

  const lookOutLeft = score(scores, 'eyeLookOutLeft')
  const lookInLeft = score(scores, 'eyeLookInLeft')
  const lookInRight = score(scores, 'eyeLookInRight')
  const lookOutRight = score(scores, 'eyeLookOutRight')
  const lookDown = (score(scores, 'eyeLookDownLeft') + score(scores, 'eyeLookDownRight')) / 2
  const lookUp = (score(scores, 'eyeLookUpLeft') + score(scores, 'eyeLookUpRight')) / 2

  const jawBlendshape = smoothstep(0.012, 0.5, score(scores, 'jawOpen'))
  const mouthGeometry = mouthLandmarkSignal(result)
  const lipArticulation = Math.max(
    score(scores, 'mouthFunnel'),
    score(scores, 'mouthPucker'),
  ) * 0.34

  const leftBlinkGeometry = eyeLandmarkBlink(result, [
    LANDMARK.leftEyeOuter,
    LANDMARK.leftEyeInner,
    LANDMARK.leftEyeUpperA,
    LANDMARK.leftEyeLowerA,
    LANDMARK.leftEyeUpperB,
    LANDMARK.leftEyeLowerB,
  ])
  const rightBlinkGeometry = eyeLandmarkBlink(result, [
    LANDMARK.rightEyeOuter,
    LANDMARK.rightEyeInner,
    LANDMARK.rightEyeUpperA,
    LANDMARK.rightEyeLowerA,
    LANDMARK.rightEyeUpperB,
    LANDMARK.rightEyeLowerB,
  ])

  const leftBlinkBlendshape = smoothstep(0.1, 0.58, score(scores, 'eyeBlinkLeft'))
  const rightBlinkBlendshape = smoothstep(0.1, 0.58, score(scores, 'eyeBlinkRight'))

  return {
    jawOpen: clamp(Math.max(jawBlendshape, mouthGeometry, lipArticulation)),
    blinkLeft: clamp(Math.max(leftBlinkBlendshape, leftBlinkGeometry * 0.98)),
    blinkRight: clamp(Math.max(rightBlinkBlendshape, rightBlinkGeometry * 0.98)),
    gazeX: clamp(
      ((lookOutLeft - lookInLeft) + (lookInRight - lookOutRight)) / 2,
      -1,
      1,
    ),
    gazeY: clamp(lookDown - lookUp, -1, 1),
    smile: smoothstep(
      0.04,
      0.75,
      (score(scores, 'mouthSmileLeft') + score(scores, 'mouthSmileRight')) / 2,
    ),
    browRaise: smoothstep(
      0.04,
      0.7,
      (
        score(scores, 'browInnerUp')
        + score(scores, 'browOuterUpLeft')
        + score(scores, 'browOuterUpRight')
      ) / 3,
    ),
  }
}

export function smoothDragonExpression(
  previous: DragonExpressionState,
  next: DragonExpressionState,
  alpha = 0.38,
): DragonExpressionState {
  const amount = clamp(alpha)
  const jawTarget = next.jawOpen < 0.018 ? 0 : next.jawOpen
  const jawAlpha = jawTarget > previous.jawOpen
    ? Math.max(amount, 0.72)
    : Math.max(amount, 0.5)
  const leftBlinkAlpha = next.blinkLeft > previous.blinkLeft
    ? Math.max(amount, 0.88)
    : Math.max(amount, 0.68)
  const rightBlinkAlpha = next.blinkRight > previous.blinkRight
    ? Math.max(amount, 0.88)
    : Math.max(amount, 0.68)

  return {
    jawOpen: lerp(previous.jawOpen, jawTarget, jawAlpha),
    blinkLeft: lerp(previous.blinkLeft, next.blinkLeft, leftBlinkAlpha),
    blinkRight: lerp(previous.blinkRight, next.blinkRight, rightBlinkAlpha),
    gazeX: lerp(previous.gazeX, next.gazeX, amount),
    gazeY: lerp(previous.gazeY, next.gazeY, amount),
    smile: lerp(previous.smile, next.smile, amount),
    browRaise: lerp(previous.browRaise, next.browRaise, amount),
  }
}
