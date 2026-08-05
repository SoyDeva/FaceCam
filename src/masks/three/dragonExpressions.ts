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

interface MouthMetrics {
  heightRatio: number
  widthRatio: number
}

interface EyeMetrics {
  openingRatio: number
}

interface AdaptiveExpressionCalibration {
  uniqueFrames: number
  missingFrames: number
  jawBaseline: number
  mouthHeightBaseline: number
  mouthWidthBaseline: number
  leftEyeOpenBaseline: number
  rightEyeOpenBaseline: number
  leftBlinkBaseline: number
  rightBlinkBaseline: number
  lastResult: FaceLandmarkerResult | null
  lastExpression: DragonExpressionState
}

const BOOTSTRAP_FRAMES = 12

function createAdaptiveCalibration(): AdaptiveExpressionCalibration {
  return {
    uniqueFrames: 0,
    missingFrames: 0,
    jawBaseline: 0,
    mouthHeightBaseline: 0,
    mouthWidthBaseline: 0,
    leftEyeOpenBaseline: 0.14,
    rightEyeOpenBaseline: 0.14,
    leftBlinkBaseline: 0,
    rightBlinkBaseline: 0,
    lastResult: null,
    lastExpression: { ...NEUTRAL_DRAGON_EXPRESSION },
  }
}

let adaptiveCalibration = createAdaptiveCalibration()

export function resetAdaptiveExpressionCalibration(): void {
  adaptiveCalibration = createAdaptiveCalibration()
}

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

function compressedResponse(value: number, deadZone: number, strength: number): number {
  const active = Math.max(0, value - deadZone)
  return clamp(1 - Math.exp(-active * strength))
}

function mouthMetrics(result: FaceLandmarkerResult | null): MouthMetrics | null {
  const landmarks = result?.faceLandmarks[0]
  if (!landmarks) return null

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
  ) return null

  const faceHeight = distance2d(forehead, chin)
  const mouthWidth = distance2d(mouthLeft, mouthRight)
  if (faceHeight < 0.08 || mouthWidth < 0.025) return null

  const innerGap = distance2d(upperInner, lowerInner)
  const outerGap = distance2d(upperOuter, lowerOuter)
  const gap = Math.max(innerGap, outerGap * 0.76)

  return {
    heightRatio: gap / faceHeight,
    widthRatio: gap / mouthWidth,
  }
}

function eyeMetrics(
  result: FaceLandmarkerResult | null,
  indices: readonly [number, number, number, number, number, number, number, number],
): EyeMetrics | null {
  const landmarks = result?.faceLandmarks[0]
  if (!landmarks) return null

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
    return null
  }

  const width = distance2d(outer, inner)
  if (width < 0.012) return null

  return {
    openingRatio: (
      distance2d(upperA, lowerA)
      + distance2d(upperB, lowerB)
      + distance2d(upperC, lowerC)
    ) / (3 * width),
  }
}

function trackFloor(current: number, value: number, initialized: boolean): number {
  if (!initialized) return value
  const alpha = value < current ? 0.22 : 0.0008
  return lerp(current, value, alpha)
}

function trackCeiling(current: number, value: number, initialized: boolean): number {
  if (!initialized) return value
  const alpha = value > current ? 0.18 : 0.0008
  return lerp(current, value, alpha)
}

function relativeBlink(opening: number | undefined, openBaseline: number): number {
  if (opening === undefined || openBaseline < 0.04) return 0
  const closureFraction = 1 - opening / openBaseline
  return smoothstep(0.12, 0.62, closureFraction)
}

function estimateStateless(
  result: FaceLandmarkerResult,
  scores: Map<string, number>,
): DragonExpressionState {
  const lookOutLeft = score(scores, 'eyeLookOutLeft')
  const lookInLeft = score(scores, 'eyeLookInLeft')
  const lookInRight = score(scores, 'eyeLookInRight')
  const lookOutRight = score(scores, 'eyeLookOutRight')
  const lookDown = (score(scores, 'eyeLookDownLeft') + score(scores, 'eyeLookDownRight')) / 2
  const lookUp = (score(scores, 'eyeLookUpLeft') + score(scores, 'eyeLookUpRight')) / 2

  const jawBlendshape = compressedResponse(score(scores, 'jawOpen'), 0.001, 13.5)
  const mouth = mouthMetrics(result)
  const heightSignal = mouth ? smoothstep(0.0009, 0.033, mouth.heightRatio) : 0
  const widthSignal = mouth ? smoothstep(0.003, 0.13, mouth.widthRatio) : 0
  const mouthGeometry = Math.pow(clamp(heightSignal * 0.82 + widthSignal * 0.18), 0.54)
  const lipArticulation = Math.max(
    score(scores, 'mouthFunnel'),
    score(scores, 'mouthPucker'),
  ) * 0.34
  const mouthClose = score(scores, 'mouthClose')
  const rawJawSignal = Math.max(jawBlendshape, mouthGeometry, lipArticulation)
  const shapedJawSignal = rawJawSignal <= 0.012
    ? 0
    : Math.pow(clamp((rawJawSignal - 0.012) / 0.988), 0.6)
  const closeSuppression = shapedJawSignal < 0.28 ? mouthClose * 0.26 : 0

  const leftEye = eyeMetrics(result, [
    LANDMARK.leftEyeOuter,
    LANDMARK.leftEyeInner,
    LANDMARK.leftEyeUpperA,
    LANDMARK.leftEyeLowerA,
    LANDMARK.leftEyeUpperB,
    LANDMARK.leftEyeLowerB,
    LANDMARK.leftEyeUpperC,
    LANDMARK.leftEyeLowerC,
  ])
  const rightEye = eyeMetrics(result, [
    LANDMARK.rightEyeOuter,
    LANDMARK.rightEyeInner,
    LANDMARK.rightEyeUpperA,
    LANDMARK.rightEyeLowerA,
    LANDMARK.rightEyeUpperB,
    LANDMARK.rightEyeLowerB,
    LANDMARK.rightEyeUpperC,
    LANDMARK.rightEyeLowerC,
  ])
  const leftBlinkGeometry = leftEye
    ? clamp(Math.pow(1 - smoothstep(0.072, 0.185, leftEye.openingRatio), 1.28))
    : 0
  const rightBlinkGeometry = rightEye
    ? clamp(Math.pow(1 - smoothstep(0.072, 0.185, rightEye.openingRatio), 1.28))
    : 0
  const leftBlinkBlendshape = compressedResponse(score(scores, 'eyeBlinkLeft'), 0.008, 7.2)
  const rightBlinkBlendshape = compressedResponse(score(scores, 'eyeBlinkRight'), 0.008, 7.2)

  return {
    jawOpen: clamp((shapedJawSignal - closeSuppression) * 1.16),
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

export function estimateDragonExpression(
  result: FaceLandmarkerResult | null,
): DragonExpressionState {
  if (!result) {
    adaptiveCalibration.missingFrames += 1
    if (adaptiveCalibration.missingFrames > 90) resetAdaptiveExpressionCalibration()
    return { ...NEUTRAL_DRAGON_EXPRESSION }
  }

  if (result === adaptiveCalibration.lastResult) {
    return { ...adaptiveCalibration.lastExpression }
  }
  adaptiveCalibration.lastResult = result

  const scores = blendshapeMap(result)
  const landmarksAvailable = Boolean(result.faceLandmarks[0])
  if (!scores.size && !landmarksAvailable) {
    adaptiveCalibration.missingFrames += 1
    if (adaptiveCalibration.missingFrames > 30) resetAdaptiveExpressionCalibration()
    return { ...NEUTRAL_DRAGON_EXPRESSION }
  }
  adaptiveCalibration.missingFrames = 0

  // Blendshape-only data is uncommon in production but useful in tests and as
  // a fallback when a browser omits landmarks. It cannot be calibrated
  // geometrically, so preserve the deterministic stateless response.
  if (!landmarksAvailable) {
    const expression = estimateStateless(result, scores)
    adaptiveCalibration.lastExpression = expression
    return { ...expression }
  }

  const mouth = mouthMetrics(result)
  const leftEye = eyeMetrics(result, [
    LANDMARK.leftEyeOuter,
    LANDMARK.leftEyeInner,
    LANDMARK.leftEyeUpperA,
    LANDMARK.leftEyeLowerA,
    LANDMARK.leftEyeUpperB,
    LANDMARK.leftEyeLowerB,
    LANDMARK.leftEyeUpperC,
    LANDMARK.leftEyeLowerC,
  ])
  const rightEye = eyeMetrics(result, [
    LANDMARK.rightEyeOuter,
    LANDMARK.rightEyeInner,
    LANDMARK.rightEyeUpperA,
    LANDMARK.rightEyeLowerA,
    LANDMARK.rightEyeUpperB,
    LANDMARK.rightEyeLowerB,
    LANDMARK.rightEyeUpperC,
    LANDMARK.rightEyeLowerC,
  ])

  const rawJaw = score(scores, 'jawOpen')
  const rawLeftBlink = score(scores, 'eyeBlinkLeft')
  const rawRightBlink = score(scores, 'eyeBlinkRight')
  const initialized = adaptiveCalibration.uniqueFrames > 0

  adaptiveCalibration.jawBaseline = trackFloor(
    adaptiveCalibration.jawBaseline,
    rawJaw,
    initialized,
  )
  if (mouth) {
    adaptiveCalibration.mouthHeightBaseline = trackFloor(
      adaptiveCalibration.mouthHeightBaseline,
      mouth.heightRatio,
      initialized,
    )
    adaptiveCalibration.mouthWidthBaseline = trackFloor(
      adaptiveCalibration.mouthWidthBaseline,
      mouth.widthRatio,
      initialized,
    )
  }
  if (leftEye) {
    adaptiveCalibration.leftEyeOpenBaseline = trackCeiling(
      adaptiveCalibration.leftEyeOpenBaseline,
      leftEye.openingRatio,
      initialized,
    )
  }
  if (rightEye) {
    adaptiveCalibration.rightEyeOpenBaseline = trackCeiling(
      adaptiveCalibration.rightEyeOpenBaseline,
      rightEye.openingRatio,
      initialized,
    )
  }
  adaptiveCalibration.leftBlinkBaseline = trackFloor(
    adaptiveCalibration.leftBlinkBaseline,
    rawLeftBlink,
    initialized,
  )
  adaptiveCalibration.rightBlinkBaseline = trackFloor(
    adaptiveCalibration.rightBlinkBaseline,
    rawRightBlink,
    initialized,
  )
  adaptiveCalibration.uniqueFrames += 1

  const lookOutLeft = score(scores, 'eyeLookOutLeft')
  const lookInLeft = score(scores, 'eyeLookInLeft')
  const lookInRight = score(scores, 'eyeLookInRight')
  const lookOutRight = score(scores, 'eyeLookOutRight')
  const lookDown = (score(scores, 'eyeLookDownLeft') + score(scores, 'eyeLookDownRight')) / 2
  const lookUp = (score(scores, 'eyeLookUpLeft') + score(scores, 'eyeLookUpRight')) / 2

  if (adaptiveCalibration.uniqueFrames <= BOOTSTRAP_FRAMES) {
    const neutral = {
      ...NEUTRAL_DRAGON_EXPRESSION,
      gazeX: clamp(
        ((lookOutLeft - lookInLeft) + (lookInRight - lookOutRight)) / 2,
        -1,
        1,
      ),
      gazeY: clamp(lookDown - lookUp, -1, 1),
    }
    adaptiveCalibration.lastExpression = neutral
    return { ...neutral }
  }

  const jawBlendshape = compressedResponse(
    rawJaw - adaptiveCalibration.jawBaseline,
    0.0015,
    18,
  )
  const mouthHeight = mouth
    ? smoothstep(
        adaptiveCalibration.mouthHeightBaseline + 0.0012,
        adaptiveCalibration.mouthHeightBaseline + 0.038,
        mouth.heightRatio,
      )
    : 0
  const mouthWidth = mouth
    ? smoothstep(
        adaptiveCalibration.mouthWidthBaseline + 0.004,
        adaptiveCalibration.mouthWidthBaseline + 0.145,
        mouth.widthRatio,
      )
    : 0
  const mouthGeometry = Math.pow(clamp(mouthHeight * 0.84 + mouthWidth * 0.16), 0.62)
  const lipArticulation = compressedResponse(
    Math.max(score(scores, 'mouthFunnel'), score(scores, 'mouthPucker')),
    0.025,
    3.2,
  ) * 0.28
  const mouthClose = score(scores, 'mouthClose')
  const jawSignal = Math.max(jawBlendshape, mouthGeometry, lipArticulation)
  const closeSuppression = jawSignal < 0.22 ? mouthClose * 0.18 : 0

  const leftBlinkBlendshape = compressedResponse(
    rawLeftBlink - adaptiveCalibration.leftBlinkBaseline,
    0.006,
    10.5,
  )
  const rightBlinkBlendshape = compressedResponse(
    rawRightBlink - adaptiveCalibration.rightBlinkBaseline,
    0.006,
    10.5,
  )
  const leftBlinkGeometry = relativeBlink(
    leftEye?.openingRatio,
    adaptiveCalibration.leftEyeOpenBaseline,
  )
  const rightBlinkGeometry = relativeBlink(
    rightEye?.openingRatio,
    adaptiveCalibration.rightEyeOpenBaseline,
  )

  const expression: DragonExpressionState = {
    jawOpen: clamp((jawSignal - closeSuppression) * 1.12),
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

  adaptiveCalibration.lastExpression = expression
  return { ...expression }
}

export function smoothDragonExpression(
  previous: DragonExpressionState,
  next: DragonExpressionState,
  alpha = 0.38,
): DragonExpressionState {
  const amount = clamp(alpha)
  const jawTarget = next.jawOpen < 0.018 ? 0 : next.jawOpen
  const jawAlpha = jawTarget > previous.jawOpen
    ? Math.max(amount, 0.9)
    : Math.max(amount, 0.78)
  const leftBlinkAlpha = next.blinkLeft > previous.blinkLeft
    ? Math.max(amount, 0.98)
    : Math.max(amount, 0.86)
  const rightBlinkAlpha = next.blinkRight > previous.blinkRight
    ? Math.max(amount, 0.98)
    : Math.max(amount, 0.86)

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
