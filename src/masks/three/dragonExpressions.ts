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

interface RuntimeEyeState {
  openBaseline: number
  lastOpening: number
  lastSeenAt: number
}

type RuntimeEyeSide = 'left' | 'right'

const RUNTIME_EYE_RESET_MS = 1_500
const BLINK_MOUTH_INTERLOCK_THRESHOLD = 0.1

const runtimeEyes: Record<RuntimeEyeSide, RuntimeEyeState> = {
  left: { openBaseline: 0, lastOpening: 0, lastSeenAt: 0 },
  right: { openBaseline: 0, lastOpening: 0, lastSeenAt: 0 },
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

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function resetRuntimeEye(side: RuntimeEyeSide): void {
  runtimeEyes[side] = { openBaseline: 0, lastOpening: 0, lastSeenAt: 0 }
}

export function resetRuntimeDragonEyeTracking(): void {
  resetRuntimeEye('left')
  resetRuntimeEye('right')
}

function blendshapeMap(result: FaceLandmarkerResult | null): Map<string, number> {
  const categories = result?.faceBlendshapes[0]?.categories ?? []
  return new Map(categories.map((category) => [category.categoryName, clamp(category.score)]))
}

function score(scores: Map<string, number>, name: string): number {
  return scores.get(name) ?? 0
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

function directBlinkEvidence(rawBlink: number): number {
  if (!Number.isFinite(rawBlink) || rawBlink <= 0.14) return 0
  const activated = smoothstep(0.14, 0.5, rawBlink)
  if (activated < 0.02) return 0
  return clamp(Math.pow(activated, 0.52))
}

// Conservative first-frame fallback. It only activates for an unmistakably
// tiny eye opening; ordinary asymmetric open eyes remain neutral.
function directGeometryBlinkEvidence(opening: number): number {
  if (!Number.isFinite(opening)) return 0
  const closure = 1 - smoothstep(0.04, 0.07, opening)
  if (closure < 0.04) return 0
  return clamp(Math.pow(closure, 0.72))
}

function calibratedEyeBlinkEvidence(
  opening: number,
  rawBlink: number,
  openReference: number,
  closedReference: number,
  blinkOpenReference: number,
  blinkClosedReference: number,
): number | null {
  const geometryRange = openReference - closedReference
  const blinkRange = blinkClosedReference - blinkOpenReference
  if (
    !Number.isFinite(openReference)
    || openReference <= 0
    || geometryRange < Math.max(0.008, openReference * 0.08)
  ) {
    return null
  }

  const geometryRatio = opening / openReference
  const nearNeutralBlink = rawBlink <= blinkOpenReference + 0.12
  if (
    nearNeutralBlink
    && opening > 0.04
    && (geometryRatio < 0.58 || geometryRatio > 1.55)
  ) {
    return null
  }

  const geometry = 1 - smoothstep(0.46, 0.84, geometryRatio)
  const blendshape = blinkRange >= 0.12
    ? smoothstep(
      0.08,
      0.88,
      (rawBlink - blinkOpenReference) / Math.max(0.0001, blinkRange),
    )
    : 0
  return Math.max(geometry, blendshape)
}

/**
 * Tracks the largest credible opening for each eye and measures closure as a
 * ratio of that live baseline. It works after the first open frame and does
 * not depend on a fixed eye size, a completed calibration, or blendshapes.
 */
function runtimeEyeBlinkEvidence(
  side: RuntimeEyeSide,
  opening: number,
  rawBlink: number,
): number | null {
  if (!Number.isFinite(opening) || opening <= 0) return null

  const now = nowMs()
  const previousState = runtimeEyes[side]
  if (previousState.lastSeenAt > 0 && now - previousState.lastSeenAt > RUNTIME_EYE_RESET_MS) {
    resetRuntimeEye(side)
  }

  const state = runtimeEyes[side]
  const direct = directBlinkEvidence(rawBlink)
  const previousOpening = state.lastOpening
  state.lastOpening = opening
  state.lastSeenAt = now

  if (state.openBaseline <= 0) {
    state.openBaseline = opening
    return direct
  }

  const baselineBeforeUpdate = Math.max(0.0001, state.openBaseline)
  const openingRatio = opening / baselineBeforeUpdate
  const geometry = 1 - smoothstep(0.48, 0.78, openingRatio)
  const rapidDrop = previousOpening > 0
    ? clamp((previousOpening - opening) / baselineBeforeUpdate)
    : 0
  const temporal = openingRatio < 0.72
    ? smoothstep(0.12, 0.38, rapidDrop)
    : 0

  // Only clearly open frames may move the baseline. A closed frame can never
  // teach the detector that the closed height is the new neutral height.
  const appearsOpen = direct < 0.18 && openingRatio >= 0.78
  if (appearsOpen) {
    if (opening > state.openBaseline) {
      state.openBaseline = lerp(state.openBaseline, opening, 0.5)
    } else if (openingRatio >= 0.9) {
      state.openBaseline = lerp(state.openBaseline, opening, 0.006)
    }
  }

  const candidate = Math.max(direct, geometry, temporal)
  if (candidate < 0.06) return 0
  return clamp(Math.pow(candidate, 0.62))
}

function maybeResetRuntimeEyesWhenTrackingIsLost(): void {
  const now = nowMs()
  for (const side of ['left', 'right'] as const) {
    const state = runtimeEyes[side]
    if (state.lastSeenAt > 0 && now - state.lastSeenAt > RUNTIME_EYE_RESET_MS) {
      resetRuntimeEye(side)
    }
  }
}

function resolveEyeBlink(
  opening: number,
  directBlink: number,
  runtimeBlink: number | null,
  calibratedBlink: number | null,
): number {
  return Math.max(
    directBlink,
    directGeometryBlinkEvidence(opening),
    runtimeBlink ?? 0,
    calibratedBlink ?? 0,
  )
}

export function estimateDragonExpression(
  result: FaceLandmarkerResult | null,
  calibration: DragonExpressionCalibration | null = null,
): DragonExpressionState {
  const scores = blendshapeMap(result)
  const metrics = extractDragonExpressionMetrics(result)
  const rawLeftBlinkScore = score(scores, 'eyeBlinkLeft')
  const rawRightBlinkScore = score(scores, 'eyeBlinkRight')
  const rawLeftBlink = directBlinkEvidence(rawLeftBlinkScore)
  const rawRightBlink = directBlinkEvidence(rawRightBlinkScore)

  if (!metrics) {
    maybeResetRuntimeEyesWhenTrackingIsLost()
    return {
      ...NEUTRAL_DRAGON_EXPRESSION,
      blinkLeft: rawLeftBlink,
      blinkRight: rawRightBlink,
    }
  }

  const runtimeLeftBlink = runtimeEyeBlinkEvidence(
    'left',
    metrics.leftEyeOpening,
    rawLeftBlinkScore,
  )
  const runtimeRightBlink = runtimeEyeBlinkEvidence(
    'right',
    metrics.rightEyeOpening,
    rawRightBlinkScore,
  )
  const calibratedLeftBlink = calibration
    ? calibratedEyeBlinkEvidence(
      metrics.leftEyeOpening,
      metrics.leftBlink,
      calibration.leftEyeOpen,
      calibration.leftEyeClosed,
      calibration.leftBlinkOpen,
      calibration.leftBlinkClosed,
    )
    : null
  const calibratedRightBlink = calibration
    ? calibratedEyeBlinkEvidence(
      metrics.rightEyeOpening,
      metrics.rightBlink,
      calibration.rightEyeOpen,
      calibration.rightEyeClosed,
      calibration.rightBlinkOpen,
      calibration.rightBlinkClosed,
    )
    : null
  const blinkLeft = resolveEyeBlink(
    metrics.leftEyeOpening,
    rawLeftBlink,
    runtimeLeftBlink,
    calibratedLeftBlink,
  )
  const blinkRight = resolveEyeBlink(
    metrics.rightEyeOpening,
    rawRightBlink,
    runtimeRightBlink,
    calibratedRightBlink,
  )
  const blinkEnergy = Math.max(blinkLeft, blinkRight)

  if (!calibration) {
    return {
      ...NEUTRAL_DRAGON_EXPRESSION,
      blinkLeft,
      blinkRight,
    }
  }

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
  const closedLipLimit = Math.max(
    0.026,
    calibration.mouthHeightNeutral + Math.max(0.0024, heightRange * 0.1),
  )
  const mouthClose = score(scores, 'mouthClose')
  const blinkMouthLock = blinkEnergy >= BLINK_MOUTH_INTERLOCK_THRESHOLD
  const neutralLock = metrics.mouthHeight <= closedLipLimit || mouthClose >= 0.58
  const articulatedJaw = Math.pow(rawJaw, 0.9) * 0.82
  const jawOpen = neutralLock || blinkMouthLock || rawJaw < 0.1
    ? 0
    : clamp(articulatedJaw - (rawJaw < 0.3 ? mouthClose * 0.12 : 0))

  const lookOutLeft = score(scores, 'eyeLookOutLeft')
  const lookInLeft = score(scores, 'eyeLookInLeft')
  const lookInRight = score(scores, 'eyeLookInRight')
  const lookOutRight = score(scores, 'eyeLookOutRight')
  const lookDown = (score(scores, 'eyeLookDownLeft') + score(scores, 'eyeLookDownRight')) / 2
  const lookUp = (score(scores, 'eyeLookUpLeft') + score(scores, 'eyeLookUpRight')) / 2

  return {
    jawOpen,
    blinkLeft: blinkLeft < 0.025 ? 0 : clamp(blinkLeft),
    blinkRight: blinkRight < 0.025 ? 0 : clamp(blinkRight),
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
  if (previous < 0.025 && candidate < 0.055) return 0
  if (previous >= 0.025 && candidate < 0.018) return 0
  return candidate
}

export function smoothDragonExpression(
  previous: DragonExpressionState,
  next: DragonExpressionState,
  alpha = 0.38,
): DragonExpressionState {
  const amount = clamp(alpha)
  const blinkMouthInterlock = Math.max(
    previous.blinkLeft,
    previous.blinkRight,
    next.blinkLeft,
    next.blinkRight,
  ) >= BLINK_MOUTH_INTERLOCK_THRESHOLD
  const jawTarget = blinkMouthInterlock
    ? 0
    : stableJawTarget(previous.jawOpen, next.jawOpen)
  const leftBlinkTarget = stableBlinkTarget(previous.blinkLeft, next.blinkLeft)
  const rightBlinkTarget = stableBlinkTarget(previous.blinkRight, next.blinkRight)

  return {
    jawOpen: blinkMouthInterlock
      ? 0
      : lerp(previous.jawOpen, jawTarget, jawTarget > previous.jawOpen ? 0.72 : 0.78),
    blinkLeft: lerp(previous.blinkLeft, leftBlinkTarget, leftBlinkTarget > previous.blinkLeft ? 0.99 : 0.9),
    blinkRight: lerp(previous.blinkRight, rightBlinkTarget, rightBlinkTarget > previous.blinkRight ? 0.99 : 0.9),
    gazeX: lerp(previous.gazeX, next.gazeX, Math.min(amount, 0.22)),
    gazeY: lerp(previous.gazeY, next.gazeY, Math.min(amount, 0.22)),
    smile: lerp(previous.smile, next.smile, Math.min(amount, 0.24)),
    browRaise: lerp(previous.browRaise, next.browRaise, Math.min(amount, 0.24)),
  }
}
