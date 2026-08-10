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
const EYE_OPEN_VETO_RATIO = 0.96
const EYE_RAW_BLINK_START = 0.30
const EYE_RAW_BLINK_FULL = 0.78
const LIVE_JAW_MAX = 0.82
const LIVE_BLINK_CLOSE_ALPHA = 0.94
const LIVE_BLINK_OPEN_ALPHA = 0.68
const LIVE_JAW_OPEN_ALPHA = 0.82
const LIVE_JAW_CLOSE_ALPHA = 0.86
const LIVE_JAW_FULL_DELTA = 0.62
const LIVE_LIP_FULL_DELTA = 0.075

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
    0.68,
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

  if (opening >= 0.065 && stableDelta <= 0.05 && rawBlink < 0.34) {
    state.stableFrames += 1
  } else {
    state.stableFrames = 0
  }

  const rawEvidence = rawBlinkEvidence(rawBlink)

  if (state.openBaseline <= 0) {
    if (opening >= EYE_BASELINE_MIN && rawBlink < 0.55) {
      state.openBaseline = opening
      return 0
    }
    return rawEvidence >= 0.72 ? rawEvidence : 0
  }

  let baseline = Math.max(0.0001, state.openBaseline)

  // Only a larger opening is allowed to raise the open-eye reference quickly.
  // Never chase a closing eyelid downward during a blink.
  if (opening > baseline && rawBlink < 0.50) {
    state.openBaseline = lerp(baseline, opening, 0.08)
    baseline = state.openBaseline
  }

  let ratio = opening / baseline

  // Long-term adaptation to a slightly smaller natural resting aperture is
  // deliberately extremely slow and only happens on clearly neutral frames.
  if (
    opening < baseline
    && ratio >= 0.92
    && state.stableFrames >= 14
    && rawBlink < 0.26
  ) {
    state.openBaseline = lerp(baseline, opening, 0.0015)
    baseline = state.openBaseline
    ratio = opening / Math.max(0.0001, baseline)
  }

  // A nearly fully open eye vetoes ordinary MediaPipe blink noise. Once the
  // eyelid starts closing, geometry is allowed to contribute immediately.
  if (ratio >= EYE_OPEN_VETO_RATIO && rawEvidence < 0.60) return 0

  const geometricClosure = 1 - smoothstep(0.42, 0.96, ratio)
  const rapidDrop = previousOpening > 0
    ? clamp((previousOpening - opening) / baseline)
    : 0
  const temporalEvidence = smoothstep(0.07, 0.26, rapidDrop)

  if (ratio >= 0.935 && rawEvidence < 0.10 && temporalEvidence < 0.08) return 0

  const candidate = Math.max(geometricClosure, rawEvidence, temporalEvidence)
  if (candidate < 0.03) return 0
  return clamp(Math.pow(candidate, 0.62))
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

  // Closed inner lips remain authoritative against false jawOpen spikes.
  if (lipDelta <= 0.0028 && lipOpening <= lipNeutral + 0.0045) return 0
  if (jawDelta <= 0.010 && lipDelta <= 0.0045) return 0

  const jawEvidence = clamp(
    (jawDelta - 0.010) / Math.max(0.0001, LIVE_JAW_FULL_DELTA - 0.010),
  )
  const lipEvidence = clamp(
    (lipDelta - 0.0025) / Math.max(0.0001, LIVE_LIP_FULL_DELTA - 0.0025),
  )

  // v31: ordinary speech must visibly articulate the dragon. Lip aperture has
  // much more authority than in v30, but it still needs plausible jaw support
  // so camera noise cannot open the mouth by itself.
  const supportedLip = Math.min(lipEvidence, jawEvidence * 2.2 + 0.16)
  const combined = jawEvidence * 0.58 + supportedLip * 0.42

  if (combined < 0.018) return 0

  const speechCurve = Math.pow(combined, 0.60) * 0.78
  const wideOpenReserve = smoothstep(0.72, 1, combined) * 0.04
  return clamp(speechCurve + wideOpenReserve, 0, LIVE_JAW_MAX)
}

function harmonizedBlinkTargets(
  left: number,
  right: number,
): { left: number; right: number } {
  const bilateral = Math.min(left, right) >= 0.16
  if (!bilateral) return { left, right }

  const mean = (left + right) / 2
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
  if (previous < 0.025 && candidate <= 0.08) return 0
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
