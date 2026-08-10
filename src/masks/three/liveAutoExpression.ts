import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { extractDragonExpressionMetrics } from './expressionCalibration'
import {
  NEUTRAL_DRAGON_EXPRESSION,
  type DragonExpressionState,
} from './dragonExpressions'

type EyeSide = 'left' | 'right'

interface EyeAutoState {
  openBaseline: number
  lastOpening: number
  lastSeenAt: number
  stableFrames: number
}

interface MouthAutoState {
  jawNeutral: number
  lipNeutral: number
  lastSeenAt: number
  neutralFrames: number
}

const TRACKING_RESET_MS = 6_000
const EYE_BASELINE_MIN = 0.075
const EYE_OPEN_VETO_RATIO = 0.93
const EYE_RAW_BLINK_START = 0.34
const EYE_RAW_BLINK_FULL = 0.80
const LIVE_JAW_MAX = 0.68
const LIVE_BLINK_CLOSE_ALPHA = 0.90
const LIVE_BLINK_OPEN_ALPHA = 0.60
const LIVE_JAW_OPEN_ALPHA = 0.68
const LIVE_JAW_CLOSE_ALPHA = 0.80
const LIVE_JAW_FULL_DELTA = 0.70
const LIVE_LIP_FULL_DELTA = 0.115

const eyes: Record<EyeSide, EyeAutoState> = {
  left: { openBaseline: 0, lastOpening: 0, lastSeenAt: 0, stableFrames: 0 },
  right: { openBaseline: 0, lastOpening: 0, lastSeenAt: 0, stableFrames: 0 },
}

let mouth: MouthAutoState = {
  jawNeutral: -1,
  lipNeutral: -1,
  lastSeenAt: 0,
  neutralFrames: 0,
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

function score(result: FaceLandmarkerResult | null, name: string): number {
  const category = result?.faceBlendshapes[0]?.categories.find(
    (candidate) => candidate.categoryName === name,
  )
  return clamp(category?.score ?? 0)
}

function resetEye(side: EyeSide): void {
  eyes[side] = { openBaseline: 0, lastOpening: 0, lastSeenAt: 0, stableFrames: 0 }
}

export function resetLiveAutoExpressionCalibration(): void {
  resetEye('left')
  resetEye('right')
  mouth = {
    jawNeutral: -1,
    lipNeutral: -1,
    lastSeenAt: 0,
    neutralFrames: 0,
  }
}

function rawBlinkEvidence(rawBlink: number): number {
  if (!Number.isFinite(rawBlink) || rawBlink <= EYE_RAW_BLINK_START) return 0
  return clamp(Math.pow(
    smoothstep(EYE_RAW_BLINK_START, EYE_RAW_BLINK_FULL, rawBlink),
    0.72,
  ))
}

function autoBlink(side: EyeSide, opening: number, rawBlink: number): number {
  if (!Number.isFinite(opening) || opening <= 0) return 0

  const now = nowMs()
  const previous = eyes[side]
  if (previous.lastSeenAt > 0 && now - previous.lastSeenAt > TRACKING_RESET_MS) {
    resetEye(side)
  }

  const state = eyes[side]
  const previousOpening = state.lastOpening
  const stableDelta = previousOpening > 0
    ? Math.abs(opening - previousOpening) / Math.max(0.0001, previousOpening)
    : 1

  state.lastOpening = opening
  state.lastSeenAt = now

  if (opening >= 0.065 && stableDelta <= 0.055 && rawBlink < 0.36) {
    state.stableFrames += 1
  } else {
    state.stableFrames = 0
  }

  const rawEvidence = rawBlinkEvidence(rawBlink)

  if (state.openBaseline <= 0) {
    // The first clear open-eye frame becomes the personal baseline. Raw blink
    // noise around 0.15-0.35 is deliberately ignored here; the user's recent
    // captures show exactly that range while the eyes are visibly open.
    if (opening >= EYE_BASELINE_MIN && rawBlink < 0.58) {
      state.openBaseline = opening
      return 0
    }

    // If tracking starts during a blink, only strong MediaPipe evidence is
    // trusted until an open-eye baseline becomes available.
    return rawEvidence >= 0.72 ? rawEvidence : 0
  }

  let baseline = Math.max(0.0001, state.openBaseline)

  // Learn wider openings, but do not chase a closing eyelid downward. The old
  // downward adaptation was the main reason slow blinks could remain static.
  if (opening > baseline && rawBlink < 0.52) {
    state.openBaseline = lerp(baseline, opening, 0.10)
    baseline = state.openBaseline
  }

  let ratio = opening / baseline

  // A tiny downward correction is allowed only after many stable, clearly-open
  // frames. This accommodates pose drift without redefining a blink as neutral.
  if (
    opening < baseline
    && ratio >= 0.90
    && state.stableFrames >= 10
    && rawBlink < 0.30
  ) {
    state.openBaseline = lerp(baseline, opening, 0.003)
    baseline = state.openBaseline
    ratio = opening / Math.max(0.0001, baseline)
  }

  // Geometry that is still essentially open vetoes ordinary blendshape noise.
  // A genuinely strong blink score can nevertheless begin closing immediately.
  if (ratio >= EYE_OPEN_VETO_RATIO && rawEvidence < 0.55) return 0

  const geometricClosure = 1 - smoothstep(0.34, 0.90, ratio)
  const rapidDrop = previousOpening > 0
    ? clamp((previousOpening - opening) / baseline)
    : 0
  const temporalEvidence = smoothstep(0.08, 0.30, rapidDrop)

  const candidate = Math.max(geometricClosure, rawEvidence, temporalEvidence)
  if (candidate < 0.025) return 0
  return clamp(Math.pow(candidate, 0.72))
}

function updateMouthNeutral(jawOpen: number, lipOpening: number, mouthClose: number): void {
  const now = nowMs()
  if (mouth.lastSeenAt > 0 && now - mouth.lastSeenAt > TRACKING_RESET_MS) {
    mouth = {
      jawNeutral: -1,
      lipNeutral: -1,
      lastSeenAt: 0,
      neutralFrames: 0,
    }
  }
  mouth.lastSeenAt = now

  const neutralCandidate = jawOpen <= 0.055
    && lipOpening <= 0.030
    && mouthClose < 0.72

  if (!neutralCandidate) {
    mouth.neutralFrames = 0
    return
  }

  mouth.neutralFrames += 1
  if (mouth.jawNeutral < 0 || mouth.lipNeutral < 0) {
    mouth.jawNeutral = jawOpen
    mouth.lipNeutral = lipOpening
    return
  }

  // Follow ordinary rest quickly downward, but never let a brief open-mouth
  // frame redefine neutral upward.
  const jawAlpha = jawOpen <= mouth.jawNeutral ? 0.16 : 0.018
  const lipAlpha = lipOpening <= mouth.lipNeutral ? 0.16 : 0.018
  mouth.jawNeutral = lerp(mouth.jawNeutral, jawOpen, jawAlpha)
  mouth.lipNeutral = lerp(mouth.lipNeutral, lipOpening, lipAlpha)
}

function autoJawOpen(
  jawOpen: number,
  lipOpening: number,
  mouthClose: number,
): number {
  updateMouthNeutral(jawOpen, lipOpening, mouthClose)

  if (mouthClose >= 0.72) return 0

  const jawNeutral = mouth.jawNeutral >= 0 ? mouth.jawNeutral : 0.018
  const lipNeutral = mouth.lipNeutral >= 0 ? mouth.lipNeutral : 0.008
  const jawDelta = Math.max(0, jawOpen - jawNeutral)
  const lipDelta = Math.max(0, lipOpening - lipNeutral)

  // The inner-lip gap remains the hard veto for false jawOpen spikes caused by
  // head motion. Eye blinks no longer force the mouth closed; both channels are
  // independent now.
  if (lipDelta <= 0.0028 && lipOpening <= lipNeutral + 0.0045) return 0
  if (jawDelta <= 0.010 && lipDelta <= 0.0045) return 0

  // MediaPipe jawOpen is used as the primary continuous signal. The old map
  // saturated around jawOpen 0.15, so ordinary speech looked fully open. The
  // new range keeps ~0.41 around a strong-but-not-maximal opening and reserves
  // the last part of the GLB travel for ~0.53-0.70 readings.
  const jawEvidence = clamp(
    (jawDelta - 0.015) / Math.max(0.0001, LIVE_JAW_FULL_DELTA - 0.015),
  )
  const lipEvidence = clamp(
    (lipDelta - 0.003) / Math.max(0.0001, LIVE_LIP_FULL_DELTA - 0.003),
  )
  const supportedLip = Math.min(lipEvidence, jawEvidence * 1.25 + 0.05)
  const combined = jawEvidence * 0.88 + supportedLip * 0.12

  if (combined < 0.025) return 0
  return clamp(Math.pow(combined, 0.80) * LIVE_JAW_MAX, 0, LIVE_JAW_MAX)
}

function harmonizedBlinkTargets(
  left: number,
  right: number,
): { left: number; right: number } {
  const bilateral = Math.min(left, right) >= 0.16
  if (!bilateral) return { left, right }

  const mean = (left + right) / 2
  // During a real bilateral blink, reduce small detector asymmetries without
  // destroying intentional one-eye winks.
  return {
    left: lerp(left, mean, 0.38),
    right: lerp(right, mean, 0.38),
  }
}

function stableJawTarget(previous: number, candidate: number): number {
  if (previous < 0.025 && candidate <= 0.055) return 0
  if (previous >= 0.025 && candidate < 0.025) return 0
  return clamp(candidate, 0, LIVE_JAW_MAX)
}

function stableBlinkTarget(previous: number, candidate: number): number {
  if (previous < 0.025 && candidate <= 0.035) return 0
  if (previous >= 0.025 && candidate < 0.015) return 0
  return clamp(candidate)
}

export function smoothLiveAutoDragonExpression(
  previous: DragonExpressionState,
  next: DragonExpressionState,
  alpha = 0.36,
): DragonExpressionState {
  const amount = clamp(alpha)
  const harmonized = harmonizedBlinkTargets(next.blinkLeft, next.blinkRight)
  const leftTarget = stableBlinkTarget(previous.blinkLeft, harmonized.left)
  const rightTarget = stableBlinkTarget(previous.blinkRight, harmonized.right)
  const jawTarget = stableJawTarget(previous.jawOpen, next.jawOpen)

  const smoothBlink = (previousBlink: number, targetBlink: number) => lerp(
    previousBlink,
    targetBlink,
    targetBlink > previousBlink ? LIVE_BLINK_CLOSE_ALPHA : LIVE_BLINK_OPEN_ALPHA,
  )

  return {
    jawOpen: lerp(
      previous.jawOpen,
      jawTarget,
      jawTarget > previous.jawOpen ? LIVE_JAW_OPEN_ALPHA : LIVE_JAW_CLOSE_ALPHA,
    ),
    blinkLeft: smoothBlink(previous.blinkLeft, leftTarget),
    blinkRight: smoothBlink(previous.blinkRight, rightTarget),
    gazeX: lerp(previous.gazeX, next.gazeX, Math.min(amount, 0.22)),
    gazeY: lerp(previous.gazeY, next.gazeY, Math.min(amount, 0.22)),
    smile: lerp(previous.smile, next.smile, Math.min(amount, 0.24)),
    browRaise: lerp(previous.browRaise, next.browRaise, Math.min(amount, 0.24)),
  }
}

export function estimateLiveAutoDragonExpression(
  result: FaceLandmarkerResult | null,
): DragonExpressionState {
  const metrics = extractDragonExpressionMetrics(result)
  if (!metrics) return { ...NEUTRAL_DRAGON_EXPRESSION }

  const blinkLeft = autoBlink('left', metrics.leftEyeOpening, metrics.leftBlink)
  const blinkRight = autoBlink('right', metrics.rightEyeOpening, metrics.rightBlink)
  const mouthClose = score(result, 'mouthClose')
  const jawOpen = autoJawOpen(
    metrics.jawOpen,
    metrics.mouthHeight,
    mouthClose,
  )

  const lookOutLeft = score(result, 'eyeLookOutLeft')
  const lookInLeft = score(result, 'eyeLookInLeft')
  const lookInRight = score(result, 'eyeLookInRight')
  const lookOutRight = score(result, 'eyeLookOutRight')
  const lookDown = (score(result, 'eyeLookDownLeft') + score(result, 'eyeLookDownRight')) / 2
  const lookUp = (score(result, 'eyeLookUpLeft') + score(result, 'eyeLookUpRight')) / 2

  return {
    jawOpen,
    blinkLeft: blinkLeft < 0.025 ? 0 : blinkLeft,
    blinkRight: blinkRight < 0.025 ? 0 : blinkRight,
    gazeX: clamp(
      ((lookOutLeft - lookInLeft) + (lookInRight - lookOutRight)) / 2,
      -1,
      1,
    ),
    gazeY: clamp(lookDown - lookUp, -1, 1),
    smile: smoothstep(
      0.12,
      0.72,
      (score(result, 'mouthSmileLeft') + score(result, 'mouthSmileRight')) / 2,
    ),
    browRaise: smoothstep(
      0.14,
      0.7,
      (
        score(result, 'browInnerUp')
        + score(result, 'browOuterUpLeft')
        + score(result, 'browOuterUpRight')
      ) / 3,
    ),
  }
}
