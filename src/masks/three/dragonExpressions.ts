import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import {
  extractDragonExpressionMetrics,
  type DragonExpressionCalibration,
} from './expressionCalibration'

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

function blendshapeMap(result: FaceLandmarkerResult | null): Map<string, number> {
  const categories = result?.faceBlendshapes[0]?.categories ?? []
  return new Map(categories.map((category) => [category.categoryName, clamp(category.score)]))
}

function score(scores: Map<string, number>, name: string): number {
  return scores.get(name) ?? 0
}

function normalizeCalibratedRange(
  value: number,
  neutral: number,
  active: number,
  deadZone = 0.12,
): number {
  const range = active - neutral
  if (!Number.isFinite(range) || range <= 0.0001) return 0
  const normalized = (value - neutral) / range
  return smoothstep(deadZone, 1, normalized)
}

function normalizeLinearRange(
  value: number,
  neutral: number,
  active: number,
  deadZone = 0.08,
): number {
  const range = active - neutral
  if (!Number.isFinite(range) || range <= 0.0001) return 0
  const normalized = (value - neutral) / range
  return clamp((normalized - deadZone) / Math.max(0.0001, 1 - deadZone))
}

function normalizeCompressedRange(
  value: number,
  neutral: number,
  calibratedActive: number,
  activeScale: number,
  deadZone: number,
): number {
  const range = calibratedActive - neutral
  if (!Number.isFinite(range) || range <= 0.0001) return 0
  return normalizeCalibratedRange(
    value,
    neutral,
    neutral + range * activeScale,
    deadZone,
  )
}

function normalizedClosure(
  opening: number,
  openValue: number,
  closedValue: number,
): number {
  const range = openValue - closedValue
  if (!Number.isFinite(range) || range <= 0.006) return 0
  return smoothstep(0.08, 0.78, (openValue - opening) / range)
}

export function estimateDragonExpression(
  result: FaceLandmarkerResult | null,
  calibration: DragonExpressionCalibration | null = null,
): DragonExpressionState {
  const metrics = extractDragonExpressionMetrics(result)
  if (!metrics || !calibration) return { ...NEUTRAL_DRAGON_EXPRESSION }

  const scores = blendshapeMap(result)

  // Lip separation is the articulation clock. MediaPipe's jawOpen channel can
  // remain elevated across a whole sentence, so it only supports the vertical
  // lip signal instead of taking control through a max(). This preserves the
  // small closures between syllables and reserves full travel for a genuinely
  // large opening.
  const lipEvidence = normalizeLinearRange(
    metrics.mouthHeight,
    calibration.mouthHeightNeutral,
    calibration.mouthHeightSpeech,
    0.07,
  )
  const jawEvidence = normalizeLinearRange(
    metrics.jawOpen,
    calibration.jawNeutral,
    calibration.jawSpeech,
    0.1,
  )
  const supportedJaw = Math.min(jawEvidence, lipEvidence * 2.5 + 0.04)
  const rawJaw = lipEvidence * 0.62 + supportedJaw * 0.38

  const heightRange = Math.max(
    0.006,
    calibration.mouthHeightSpeech - calibration.mouthHeightNeutral,
  )
  const jawRange = Math.max(0.02, calibration.jawSpeech - calibration.jawNeutral)
  const neutralLock = metrics.mouthHeight
      <= calibration.mouthHeightNeutral + Math.max(0.0018, heightRange * 0.065)
    && metrics.jawOpen
      <= calibration.jawNeutral + Math.max(0.012, jawRange * 0.075)
  const mouthClose = score(scores, 'mouthClose')
  const articulatedJaw = Math.pow(rawJaw, 0.9) * 0.82
  const jawOpen = neutralLock || rawJaw < 0.07
    ? 0
    : clamp(articulatedJaw - (rawJaw < 0.3 ? mouthClose * 0.12 : 0))

  const leftBlinkGeometry = normalizedClosure(
    metrics.leftEyeOpening,
    calibration.leftEyeOpen,
    calibration.leftEyeClosed,
  )
  const rightBlinkGeometry = normalizedClosure(
    metrics.rightEyeOpening,
    calibration.rightEyeOpen,
    calibration.rightEyeClosed,
  )
  const leftBlinkScore = normalizeCompressedRange(
    metrics.leftBlink,
    calibration.leftBlinkOpen,
    calibration.leftBlinkClosed,
    0.82,
    0.1,
  )
  const rightBlinkScore = normalizeCompressedRange(
    metrics.rightBlink,
    calibration.rightBlinkOpen,
    calibration.rightBlinkClosed,
    0.82,
    0.1,
  )

  // A fast natural blink is often shorter and weaker than the guided closed-eye
  // calibration sample. Keep the calibrated channels, but add MediaPipe's raw
  // eyeBlink signal as an independent rescue path so brief closures are not
  // discarded and rendered as permanently static eyes.
  const directLeftBlink = smoothstep(0.16, 0.68, score(scores, 'eyeBlinkLeft'))
  const directRightBlink = smoothstep(0.16, 0.68, score(scores, 'eyeBlinkRight'))
  const blinkLeft = Math.pow(
    Math.max(leftBlinkGeometry, leftBlinkScore, directLeftBlink),
    0.68,
  )
  const blinkRight = Math.pow(
    Math.max(rightBlinkGeometry, rightBlinkScore, directRightBlink),
    0.68,
  )

  const lookOutLeft = score(scores, 'eyeLookOutLeft')
  const lookInLeft = score(scores, 'eyeLookInLeft')
  const lookInRight = score(scores, 'eyeLookInRight')
  const lookOutRight = score(scores, 'eyeLookOutRight')
  const lookDown = (score(scores, 'eyeLookDownLeft') + score(scores, 'eyeLookDownRight')) / 2
  const lookUp = (score(scores, 'eyeLookUpLeft') + score(scores, 'eyeLookUpRight')) / 2

  return {
    jawOpen,
    blinkLeft: blinkLeft < 0.04 ? 0 : clamp(blinkLeft),
    blinkRight: blinkRight < 0.04 ? 0 : clamp(blinkRight),
    gazeX: clamp(
      ((lookOutLeft - lookInLeft) + (lookInRight - lookOutRight)) / 2,
      -1,
      1,
    ),
    gazeY: clamp(lookDown - lookUp, -1, 1),
    smile: smoothstep(
      0.12,
      0.72,
      (score(scores, 'mouthSmileLeft') + score(scores, 'mouthSmileRight')) / 2,
    ),
    browRaise: smoothstep(
      0.14,
      0.7,
      (
        score(scores, 'browInnerUp')
        + score(scores, 'browOuterUpLeft')
        + score(scores, 'browOuterUpRight')
      ) / 3,
    ),
  }
}

function stableJawTarget(previous: number, candidate: number): number {
  if (previous < 0.035 && candidate < 0.18) return 0
  if (previous >= 0.035 && candidate < 0.13) return 0
  return candidate
}

function stableBlinkTarget(previous: number, candidate: number): number {
  if (previous < 0.04 && candidate < 0.12) return 0
  if (previous >= 0.04 && candidate < 0.035) return 0
  return candidate
}

export function smoothDragonExpression(
  previous: DragonExpressionState,
  next: DragonExpressionState,
  alpha = 0.38,
): DragonExpressionState {
  const amount = clamp(alpha)
  const jawTarget = stableJawTarget(previous.jawOpen, next.jawOpen)
  const leftBlinkTarget = stableBlinkTarget(previous.blinkLeft, next.blinkLeft)
  const rightBlinkTarget = stableBlinkTarget(previous.blinkRight, next.blinkRight)

  return {
    jawOpen: lerp(previous.jawOpen, jawTarget, jawTarget > previous.jawOpen ? 0.72 : 0.78),
    blinkLeft: lerp(previous.blinkLeft, leftBlinkTarget, leftBlinkTarget > previous.blinkLeft ? 0.98 : 0.82),
    blinkRight: lerp(previous.blinkRight, rightBlinkTarget, rightBlinkTarget > previous.blinkRight ? 0.98 : 0.82),
    gazeX: lerp(previous.gazeX, next.gazeX, Math.min(amount, 0.22)),
    gazeY: lerp(previous.gazeY, next.gazeY, Math.min(amount, 0.22)),
    smile: lerp(previous.smile, next.smile, Math.min(amount, 0.24)),
    browRaise: lerp(previous.browRaise, next.browRaise, Math.min(amount, 0.24)),
  }
}