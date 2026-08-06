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
  trustworthyOpenSamples: number
  lastOpening: number
  lastSeenAt: number
}

type RuntimeEyeSide = 'left' | 'right'

const RUNTIME_OPEN_SAMPLE_TARGET = 20
const RUNTIME_EYE_RESET_MS = 1_500

const runtimeEyes: Record<RuntimeEyeSide, RuntimeEyeState> = {
  left: {
    openBaseline: 0,
    trustworthyOpenSamples: 0,
    lastOpening: 0,
    lastSeenAt: 0,
  },
  right: {
    openBaseline: 0,
    trustworthyOpenSamples: 0,
    lastOpening: 0,
    lastSeenAt: 0,
  },
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
  runtimeEyes[side] = {
    openBaseline: 0,
    trustworthyOpenSamples: 0,
    lastOpening: 0,
    lastSeenAt: 0,
  }
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

/**
 * MediaPipe's eyeBlink channels provide immediate evidence, but some cameras
 * report these values weakly or permanently at zero. Geometry must therefore
 * remain available as an independent path.
 */
function directBlinkEvidence(rawBlink: number): number {
  if (!Number.isFinite(rawBlink) || rawBlink <= 0.08) return 0
  const activated = smoothstep(0.08, 0.52, rawBlink)
  if (activated < 0.035) return 0
  return clamp(Math.pow(activated, 0.52))
}

/**
 * Absolute geometry is used only while the live per-eye baseline is learning.
 * Its threshold accepts only a clear closure, avoiding the permanent
 * half-closed bias caused by naturally asymmetric open eyes.
 */
function directGeometryBlinkEvidence(opening: number): number {
  if (!Number.isFinite(opening)) return 0
  const closure = 1 - smoothstep(0.045, 0.095, opening)
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
    || openReference < 0.05
    || openReference > 0.22
    || geometryRange < 0.012
    || blinkRange < 0.18
  ) {
    return null
  }

  const apparentOpenRatio = opening / openReference
  const nearNeutralBlink = rawBlink <= blinkOpenReference + 0.12
  if (
    nearNeutralBlink
    && opening > 0.045
    && (apparentOpenRatio < 0.58 || apparentOpenRatio > 1.55)
  ) {
    return null
  }

  const geometry = smoothstep(
    0.08,
    0.78,
    (openReference - opening) / geometryRange,
  )
  const compressedBlinkRange = blinkRange * 0.5
  const normalizedBlink = (rawBlink - blinkOpenReference) / Math.max(0.0001, compressedBlinkRange)
  const blendshape = smoothstep(0.1, 1, normalizedBlink)
  return Math.max(geometry, blendshape)
}

/**
 * Learns each eye's actual open height during the current camera session.
 * Once ready, this signal owns the eyes while the stored mouth calibration
 * remains untouched. Stored eye ranges from older GLBs are never consulted.
 */
function runtimeEyeBlinkEvidence(
  side: RuntimeEyeSide,
  opening: number,
  rawBlink: number,
): number | null {
  if (!Number.isFinite(opening) || opening <= 0) return null

  const state = runtimeEyes[side]
  const now = nowMs()
  if (state.lastSeenAt > 0 && now - state.lastSeenAt > RUNTIME_EYE_RESET_MS) {
    resetRuntimeEye(side)
  }

  const current = runtimeEyes[side]
  current.lastSeenAt = now
  const direct = directBlinkEvidence(rawBlink)
  const previousOpening = current.lastOpening
  current.lastOpening = opening

  const trustworthyOpen = rawBlink < 0.3 && opening > 0.045
  if (trustworthyOpen) {
    if (current.openBaseline <= 0) {
      current.openBaseline = opening
      current.trustworthyOpenSamples = 1
    } else if (opening > current.openBaseline) {
      current.openBaseline = lerp(current.openBaseline, opening, 0.34)
      current.trustworthyOpenSamples = Math.min(
        RUNTIME_OPEN_SAMPLE_TARGET,
        current.trustworthyOpenSamples + 1,
      )
    } else if (opening >= current.openBaseline * 0.82) {
      current.openBaseline = lerp(current.openBaseline, opening, 0.012)
      current.trustworthyOpenSamples = Math.min(
        RUNTIME_OPEN_SAMPLE_TARGET,
        current.trustworthyOpenSamples + 1,
      )
    }
  }

  if (
    current.trustworthyOpenSamples < RUNTIME_OPEN_SAMPLE_TARGET
    || current.openBaseline < 0.05
  ) {
    return null
  }

  const openingRatio = opening / current.openBaseline
  const geometry = 1 - smoothstep(0.38, 0.78, openingRatio)
  const rapidDrop = previousOpening > 0
    ? clamp((previousOpening - opening) / current.openBaseline)
    : 0
  const decisiveClosure = geometry >= 0.62 || direct >= 0.35 || rapidDrop >= 0.1
  const candidate = Math.max(
    direct,
    decisiveClosure ? geometry : geometry * 0.42,
  )

  if (candidate < 0.07) return 0
  return clamp(Math.pow(candidate, 0.7))
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
  return runtimeBlink
    ?? calibratedBlink
    ?? Math.max(directBlink, directGeometryBlinkEvidence(opening))
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
      blinkLeft: calibration ? 0 : rawLeftBlink,
      blinkRight: calibration ? 0 : rawRightBlink,
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

  // Mouth articulation remains neutral until its personal range has been
  // measured. Eye movement never depends on that calibration.
  if (!calibration) {
    return {
      ...NEUTRAL_DRAGON_EXPRESSION,
      blinkLeft,
      blinkRight,
    }
  }

  // Lip separation is the articulation clock. MediaPipe's jawOpen channel can
  // remain elevated across a whole sentence, so it only supports the vertical
  // lip signal instead of taking control through a max(). This is the approved
  // mouth architecture from PR #26.
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

  // Closed lips always win over a noisy jawOpen blendshape. This prevents the
  // mouth from talking by itself after an imperfect recalibration.
  const neutralLock = metrics.mouthHeight <= closedLipLimit || mouthClose >= 0.58
  const articulatedJaw = Math.pow(rawJaw, 0.9) * 0.82
  const jawOpen = neutralLock || rawJaw < 0.1
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
    blinkLeft: blinkLeft < 0.045 ? 0 : clamp(blinkLeft),
    blinkRight: blinkRight < 0.045 ? 0 : clamp(blinkRight),
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
  if (previous < 0.035 && candidate < 0.1) return 0
  if (previous >= 0.035 && candidate < 0.025) return 0
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
    blinkLeft: lerp(previous.blinkLeft, leftBlinkTarget, leftBlinkTarget > previous.blinkLeft ? 0.99 : 0.9),
    blinkRight: lerp(previous.blinkRight, rightBlinkTarget, rightBlinkTarget > previous.blinkRight ? 0.99 : 0.9),
    gazeX: lerp(previous.gazeX, next.gazeX, Math.min(amount, 0.22)),
    gazeY: lerp(previous.gazeY, next.gazeY, Math.min(amount, 0.22)),
    smile: lerp(previous.smile, next.smile, Math.min(amount, 0.24)),
    browRaise: lerp(previous.browRaise, next.browRaise, Math.min(amount, 0.24)),
  }
}
