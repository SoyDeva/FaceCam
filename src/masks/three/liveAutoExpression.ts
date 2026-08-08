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
const ABSOLUTELY_OPEN_EYE = 0.16
const OPEN_RATIO = 0.80

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

  if (opening >= 0.065 && stableDelta <= 0.07 && rawBlink < 0.72) {
    state.stableFrames += 1
  } else {
    state.stableFrames = 0
  }

  // Strong geometric opening is authoritative. This specifically protects
  // faces for which MediaPipe reports eyeBlink around 0.25-0.40 at rest.
  if (opening >= ABSOLUTELY_OPEN_EYE && rawBlink < 0.78) {
    if (state.openBaseline <= 0) state.openBaseline = opening
    else state.openBaseline = lerp(state.openBaseline, opening, opening > state.openBaseline ? 0.01 : 0.08)
    return 0
  }

  if (state.openBaseline <= 0) {
    if (state.stableFrames >= 2 || (opening >= 0.075 && rawBlink < 0.48)) {
      state.openBaseline = opening
      return 0
    }

    // Before a neutral reference exists, only an unmistakable closure is
    // allowed to move the eyelid. Raw blendshape noise alone is insufficient.
    if (opening <= 0.055 && rawBlink >= 0.58) {
      return clamp(Math.pow(Math.max(
        smoothstep(0.055, 0.025, opening),
        smoothstep(0.58, 0.88, rawBlink),
      ), 0.62))
    }
    return 0
  }

  const baseline = Math.max(0.0001, state.openBaseline)
  const ratio = opening / baseline

  if (ratio >= OPEN_RATIO) {
    if (rawBlink < 0.7) {
      const adaptation = opening > baseline ? 0.008 : 0.07
      state.openBaseline = lerp(baseline, opening, adaptation)
    }
    return 0
  }

  const geometricClosure = 1 - smoothstep(0.36, 0.78, ratio)
  const rawEvidence = smoothstep(0.48, 0.86, rawBlink)
  const rapidDrop = previousOpening > 0
    ? clamp((previousOpening - opening) / baseline)
    : 0
  const temporalEvidence = smoothstep(0.08, 0.30, rapidDrop)

  // A moderate closure needs corroboration. A very deep geometric closure can
  // stand on its own so winks continue to work even if blendshapes are weak.
  if (ratio <= 0.50) {
    return clamp(Math.pow(Math.max(geometricClosure, rawEvidence, temporalEvidence), 0.60))
  }

  if (rawEvidence < 0.08 && temporalEvidence < 0.08) return 0
  return clamp(Math.pow(Math.max(
    geometricClosure * 0.92,
    rawEvidence,
    temporalEvidence,
  ), 0.64))
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
  bilateralBlink: number,
): number {
  updateMouthNeutral(jawOpen, lipOpening, mouthClose)

  if (bilateralBlink >= 0.16 || mouthClose >= 0.62) return 0

  const jawNeutral = mouth.jawNeutral >= 0 ? mouth.jawNeutral : 0.018
  const lipNeutral = mouth.lipNeutral >= 0 ? mouth.lipNeutral : 0.008
  const jawDelta = Math.max(0, jawOpen - jawNeutral)
  const lipDelta = Math.max(0, lipOpening - lipNeutral)

  // Closed inner lips veto false jawOpen spikes. This is important during
  // blinks and head motion, when MediaPipe can briefly spike jawOpen.
  if (lipDelta <= 0.0028 && lipOpening <= lipNeutral + 0.0045) return 0
  if (jawDelta <= 0.012 && lipDelta <= 0.0045) return 0

  const jawEvidence = smoothstep(0.014, 0.145, jawDelta)
  const lipEvidence = smoothstep(0.003, 0.034, lipDelta)
  const supportedLip = Math.min(lipEvidence, jawEvidence * 1.65 + 0.10)
  const combined = jawEvidence * 0.68 + supportedLip * 0.32

  if (combined < 0.075) return 0
  return clamp(Math.pow(combined, 0.84) * 0.82, 0, 0.82)
}

export function estimateLiveAutoDragonExpression(
  result: FaceLandmarkerResult | null,
): DragonExpressionState {
  const metrics = extractDragonExpressionMetrics(result)
  if (!metrics) return { ...NEUTRAL_DRAGON_EXPRESSION }

  const blinkLeft = autoBlink('left', metrics.leftEyeOpening, metrics.leftBlink)
  const blinkRight = autoBlink('right', metrics.rightEyeOpening, metrics.rightBlink)
  const bilateralBlink = Math.min(blinkLeft, blinkRight)
  const mouthClose = score(result, 'mouthClose')
  const jawOpen = autoJawOpen(
    metrics.jawOpen,
    metrics.mouthHeight,
    mouthClose,
    bilateralBlink,
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
