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

function normalizedClosure(
  opening: number,
  openValue: number,
  closedValue: number,
): number {
  const range = openValue - closedValue
  if (!Number.isFinite(range) || range <= 0.006) return 0
  return smoothstep(0.16, 0.92, (openValue - opening) / range)
}

export function estimateDragonExpression(
  result: FaceLandmarkerResult | null,
  calibration: DragonExpressionCalibration | null = null,
): DragonExpressionState {
  const metrics = extractDragonExpressionMetrics(result)
  if (!metrics || !calibration) return { ...NEUTRAL_DRAGON_EXPRESSION }

  const scores = blendshapeMap(result)
  const jawByBlendshape = normalizeCalibratedRange(
    metrics.jawOpen,
    calibration.jawNeutral,
    calibration.jawSpeech,
    0.15,
  )
  const jawByHeight = normalizeCalibratedRange(
    metrics.mouthHeight,
    calibration.mouthHeightNeutral,
    calibration.mouthHeightSpeech,
    0.12,
  )
  const jawByWidth = normalizeCalibratedRange(
    metrics.mouthWidth,
    calibration.mouthWidthNeutral,
    calibration.mouthWidthSpeech,
    0.14,
  )
  const rawJaw = Math.max(jawByBlendshape, jawByHeight * 0.94, jawByWidth * 0.78)
  const mouthClose = score(scores, 'mouthClose')
  const jawOpen = rawJaw < 0.075
    ? 0
    : clamp(Math.pow(rawJaw, 0.86) - (rawJaw < 0.28 ? mouthClose * 0.12 : 0))

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
  const leftBlinkScore = normalizeCalibratedRange(
    metrics.leftBlink,
    calibration.leftBlinkOpen,
    calibration.leftBlinkClosed,
    0.18,
  )
  const rightBlinkScore = normalizeCalibratedRange(
    metrics.rightBlink,
    calibration.rightBlinkOpen,
    calibration.rightBlinkClosed,
    0.18,
  )
  const blinkLeft = Math.max(leftBlinkGeometry, leftBlinkScore)
  const blinkRight = Math.max(rightBlinkGeometry, rightBlinkScore)

  const lookOutLeft = score(scores, 'eyeLookOutLeft')
  const lookInLeft = score(scores, 'eyeLookInLeft')
  const lookInRight = score(scores, 'eyeLookInRight')
  const lookOutRight = score(scores, 'eyeLookOutRight')
  const lookDown = (score(scores, 'eyeLookDownLeft') + score(scores, 'eyeLookDownRight')) / 2
  const lookUp = (score(scores, 'eyeLookUpLeft') + score(scores, 'eyeLookUpRight')) / 2

  return {
    jawOpen,
    blinkLeft: blinkLeft < 0.1 ? 0 : blinkLeft,
    blinkRight: blinkRight < 0.1 ? 0 : blinkRight,
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
  if (previous >= 0.035 && candidate < 0.055) return 0
  return candidate
}

function stableBlinkTarget(previous: number, candidate: number): number {
  if (previous < 0.06 && candidate < 0.45) return 0
  if (previous >= 0.06 && candidate < 0.1) return 0
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
    jawOpen: lerp(previous.jawOpen, jawTarget, jawTarget > previous.jawOpen ? 0.68 : 0.52),
    blinkLeft: lerp(previous.blinkLeft, leftBlinkTarget, leftBlinkTarget > previous.blinkLeft ? 0.92 : 0.7),
    blinkRight: lerp(previous.blinkRight, rightBlinkTarget, rightBlinkTarget > previous.blinkRight ? 0.92 : 0.7),
    gazeX: lerp(previous.gazeX, next.gazeX, Math.min(amount, 0.22)),
    gazeY: lerp(previous.gazeY, next.gazeY, Math.min(amount, 0.22)),
    smile: lerp(previous.smile, next.smile, Math.min(amount, 0.24)),
    browRaise: lerp(previous.browRaise, next.browRaise, Math.min(amount, 0.24)),
  }
}
