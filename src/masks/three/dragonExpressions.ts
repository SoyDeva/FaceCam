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
  upperLipInner: 13,
  lowerLipInner: 14,
  upperLipOuter: 0,
  lowerLipOuter: 17,
  leftEyeOuter: 33,
  leftEyeInner: 133,
  leftEyeUpperA: 159,
  leftEyeLowerA: 145,
  leftEyeUpperB: 160,
  leftEyeLowerB: 144,
  leftEyeUpperC: 158,
  leftEyeLowerC: 153,
  rightEyeInner: 362,
  rightEyeOuter: 263,
  rightEyeUpperA: 386,
  rightEyeLowerA: 374,
  rightEyeUpperB: 385,
  rightEyeLowerB: 380,
  rightEyeUpperC: 387,
  rightEyeLowerC: 373,
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

/**
 * Compresses the low end of a MediaPipe score so normal speech and short
 * blinks use more of the morph target's available range. The exponential
 * response preserves a stable neutral zone while reaching full expression
 * without requiring exaggerated human movement.
 */
function compressedResponse(value: number, deadZone: number, strength: number): number {
  const active = Math.max(0, value - deadZone)
  return clamp(1 - Math.exp(-active * strength))
}

function mouthLandmarkSignal(result: FaceLandmarkerResult | null): number {
  const landmarks = result?.faceLandmarks[0]
  if (!landmarks) return 0

  const upperInner = landmarks[LANDMARK.upperLipInner]
  const lowerInner = landmarks[LANDMARK.lowerLipInner]
  const upperOuter = landmarks[LANDMARK.upperLipOuter]
  const lowerOuter = landmarks[LANDMARK.lowerLipOuter]
  const forehead = landmarks[LANDMARK.forehead]
  const chin = landmarks[LANDMARK.chin]
  const mouthLeft = landmarks[LANDMARK.mouthLeft]
  const mouthRight = landmarks[LANDMARK.mouthRight]
  if (
    !upperInner
    || !lowerInner
    || !upperOuter
    || !lowerOuter
    || !forehead
    || !chin
    || !mouthLeft
    || !mouthRight
  ) return 0

  const faceHeight = distance2d(forehead, chin)
  const mouthWidth = distance2d(mouthLeft, mouthRight)
  if (faceHeight < 0.08 || mouthWidth < 0.025) return 0

  const innerGap = distance2d(upperInner, lowerInner)
  const outerGap = distance2d(upperOuter, lowerOuter)
  const gap = Math.max(innerGap, outerGap * 0.72)
  const heightRatio = gap / faceHeight
  const widthRatio = gap / mouthWidth

  // Normal conversational articulation often occupies only the first third of
  // the landmark range. These curves deliberately expose that useful range.
  const heightSignal = smoothstep(0.0018, 0.061, heightRatio)
  const widthSignal = smoothstep(0.006, 0.235, widthRatio)
  const combined = clamp(heightSignal * 0.76 + widthSignal * 0.24)
  return Math.pow(combined, 0.72)
}

function eyeLandmarkBlink(
  result: FaceLandmarkerResult | null,
  indices: readonly [number, number, number, number, number, number, number, number],
): number {
  const landmarks = result?.faceLandmarks[0]
  if (!landmarks) return 0

  const [
    outerIndex,
    innerIndex,
    upperAIndex,
    lowerAIndex,
    upperBIndex,
    lowerBIndex,
    upperCIndex,
    lowerCIndex,
  ] = indices
  const outer = landmarks[outerIndex]
  const inner = landmarks[innerIndex]
  const upperA = landmarks[upperAIndex]
  const lowerA = landmarks[lowerAIndex]
  const upperB = landmarks[upperBIndex]
  const lowerB = landmarks[lowerBIndex]
  const upperC = landmarks[upperCIndex]
  const lowerC = landmarks[lowerCIndex]
  if (!outer || !inner || !upperA || !lowerA || !upperB || !lowerB || !upperC || !lowerC) {
    return 0
  }

  const width = distance2d(outer, inner)
  if (width < 0.012) return 0

  const opening = (
    distance2d(upperA, lowerA)
    + distance2d(upperB, lowerB)
    + distance2d(upperC, lowerC)
  ) / (3 * width)

  // Squaring suppresses tiny camera jitter while still producing a decisive
  // closure as soon as the eyelids approach each other.
  const closure = 1 - smoothstep(0.072, 0.185, opening)
  return clamp(Math.pow(closure, 1.28))
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

  const jawBlendshape = compressedResponse(score(scores, 'jawOpen'), 0.003, 7.4)
  const mouthGeometry = mouthLandmarkSignal(result)
  const lipArticulation = Math.max(
    score(scores, 'mouthFunnel'),
    score(scores, 'mouthPucker'),
  ) * 0.22
  const mouthClose = score(scores, 'mouthClose')
  const jawSignal = Math.max(jawBlendshape, mouthGeometry, lipArticulation)
  const closeSuppression = jawSignal < 0.2 ? mouthClose * 0.2 : 0

  const leftBlinkGeometry = eyeLandmarkBlink(result, [
    LANDMARK.leftEyeOuter,
    LANDMARK.leftEyeInner,
    LANDMARK.leftEyeUpperA,
    LANDMARK.leftEyeLowerA,
    LANDMARK.leftEyeUpperB,
    LANDMARK.leftEyeLowerB,
    LANDMARK.leftEyeUpperC,
    LANDMARK.leftEyeLowerC,
  ])
  const rightBlinkGeometry = eyeLandmarkBlink(result, [
    LANDMARK.rightEyeOuter,
    LANDMARK.rightEyeInner,
    LANDMARK.rightEyeUpperA,
    LANDMARK.rightEyeLowerA,
    LANDMARK.rightEyeUpperB,
    LANDMARK.rightEyeLowerB,
    LANDMARK.rightEyeUpperC,
    LANDMARK.rightEyeLowerC,
  ])

  const leftBlinkBlendshape = compressedResponse(score(scores, 'eyeBlinkLeft'), 0.008, 7.2)
  const rightBlinkBlendshape = compressedResponse(score(scores, 'eyeBlinkRight'), 0.008, 7.2)

  return {
    jawOpen: clamp((jawSignal - closeSuppression) * 1.08),
    blinkLeft: clamp(Math.max(leftBlinkBlendshape, leftBlinkGeometry)),
    blinkRight: clamp(Math.max(rightBlinkBlendshape, rightBlinkGeometry)),
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
  const jawTarget = next.jawOpen < 0.022 ? 0 : next.jawOpen
  const jawAlpha = jawTarget > previous.jawOpen
    ? Math.max(amount, 0.86)
    : Math.max(amount, 0.68)
  const leftBlinkAlpha = next.blinkLeft > previous.blinkLeft
    ? Math.max(amount, 0.96)
    : Math.max(amount, 0.82)
  const rightBlinkAlpha = next.blinkRight > previous.blinkRight
    ? Math.max(amount, 0.96)
    : Math.max(amount, 0.82)

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
