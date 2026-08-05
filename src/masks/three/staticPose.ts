import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import {
  estimateDragonExpression,
  NEUTRAL_DRAGON_EXPRESSION,
  smoothDragonExpression,
  type DragonExpressionState,
} from './dragonExpressions'

export interface StaticDragonPoseEstimate extends DragonExpressionState {
  visible: boolean
  centerX: number
  centerY: number
  eyeCenterX: number
  eyeCenterY: number
  eyeDistance: number
  faceWidth: number
  faceHeight: number
  foreheadX: number
  foreheadY: number
  chinX: number
  chinY: number
  neckAnchorX: number
  neckAnchorY: number
  roll: number
  yaw: number
  pitch: number
}

const LANDMARK = {
  forehead: 10,
  chin: 152,
  leftTemple: 234,
  rightTemple: 454,
  leftEyeOuter: 33,
  leftEyeInner: 133,
  rightEyeInner: 362,
  rightEyeOuter: 263,
  noseTip: 1,
} as const

function invisiblePose(): StaticDragonPoseEstimate {
  return {
    visible: false,
    centerX: 0.5,
    centerY: 0.5,
    eyeCenterX: 0.5,
    eyeCenterY: 0.5,
    eyeDistance: 0,
    faceWidth: 0,
    faceHeight: 0,
    foreheadX: 0.5,
    foreheadY: 0.3,
    chinX: 0.5,
    chinY: 0.7,
    neckAnchorX: 0.5,
    neckAnchorY: 0.82,
    roll: 0,
    yaw: 0,
    pitch: 0,
    ...NEUTRAL_DRAGON_EXPRESSION,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function lerp(previous: number, next: number, alpha: number): number {
  return previous + (next - previous) * alpha
}

function distance2d(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function midpoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * A dead-band followed by adaptive interpolation removes sub-pixel camera
 * noise without making intentional head movements feel heavy. Motion inside
 * the dead-band is held exactly at the previous value; larger movement keeps
 * a faster response.
 */
function stableLerp(
  previous: number,
  next: number,
  baseAlpha: number,
  deadBand: number,
  fastThreshold: number,
): number {
  const delta = next - previous
  const magnitude = Math.abs(delta)
  if (magnitude <= deadBand) return previous

  const target = next - Math.sign(delta) * deadBand
  const response = magnitude >= fastThreshold
    ? Math.max(baseAlpha, 0.45)
    : Math.min(baseAlpha, 0.18)
  return lerp(previous, target, response)
}

/**
 * Schmitt-trigger style hysteresis for the jaw. Noise must cross a clear
 * activation threshold before the mouth starts moving, while a lower release
 * threshold lets real speech close cleanly between syllables.
 */
function stabilizeJaw(previous: number, candidate: number): number {
  const activationThreshold = 0.2
  const releaseThreshold = 0.075

  if (previous <= 0.04 && candidate < activationThreshold) return 0
  if (previous > 0.04 && candidate < releaseThreshold) return 0
  if (Math.abs(candidate - previous) < 0.035) return previous

  return lerp(previous, candidate, candidate > previous ? 0.72 : 0.62)
}

/**
 * Blinks are deliberately decisive: weak eyelid noise is ignored, while a
 * genuine closure crosses the higher activation threshold and then releases
 * quickly. This avoids constant eye flutter on low-light mobile cameras.
 */
function stabilizeBlink(previous: number, candidate: number): number {
  const activationThreshold = 0.52
  const releaseThreshold = 0.16

  if (previous <= 0.08 && candidate < activationThreshold) return 0
  if (previous > 0.08 && candidate < releaseThreshold) return 0
  if (Math.abs(candidate - previous) < 0.07) return previous

  return lerp(previous, candidate, candidate > previous ? 0.88 : 0.72)
}

function stabilizeSoftExpression(previous: number, candidate: number): number {
  if (candidate < 0.12 && previous < 0.12) return 0
  if (Math.abs(candidate - previous) < 0.045) return previous
  return lerp(previous, candidate, 0.32)
}

export function estimateStaticDragonPose(
  result: FaceLandmarkerResult | null,
): StaticDragonPoseEstimate {
  const landmarks = result?.faceLandmarks[0]
  if (!landmarks) return invisiblePose()

  const forehead = landmarks[LANDMARK.forehead]
  const chin = landmarks[LANDMARK.chin]
  const leftTemple = landmarks[LANDMARK.leftTemple]
  const rightTemple = landmarks[LANDMARK.rightTemple]
  const leftEyeOuter = landmarks[LANDMARK.leftEyeOuter]
  const leftEyeInner = landmarks[LANDMARK.leftEyeInner]
  const rightEyeInner = landmarks[LANDMARK.rightEyeInner]
  const rightEyeOuter = landmarks[LANDMARK.rightEyeOuter]
  const nose = landmarks[LANDMARK.noseTip]

  if (
    !forehead
    || !chin
    || !leftTemple
    || !rightTemple
    || !leftEyeOuter
    || !leftEyeInner
    || !rightEyeInner
    || !rightEyeOuter
    || !nose
  ) {
    return invisiblePose()
  }

  const leftEye = midpoint(leftEyeOuter, leftEyeInner)
  const rightEye = midpoint(rightEyeInner, rightEyeOuter)
  const eyeCenter = midpoint(leftEye, rightEye)
  const eyeDistance = distance2d(leftEye, rightEye)
  const faceWidth = distance2d(leftTemple, rightTemple)
  const faceHeight = Math.max(0.001, distance2d(forehead, chin))
  if (!Number.isFinite(faceWidth) || faceWidth < 0.025 || eyeDistance < 0.01) {
    return invisiblePose()
  }

  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x)

  // MediaPipe z is relative to head scale. Temple depth difference remains
  // useful for rotation and is corrected before any distance inference.
  const yaw = clamp((leftTemple.z - rightTemple.z) / faceWidth * 1.35, -0.95, 0.95)

  const noseRatio = (nose.y - forehead.y) / faceHeight
  const pitch = clamp((noseRatio - 0.5) * 1.45, -0.55, 0.55)

  // Face Landmarker does not include shoulders. The neck anchor is therefore
  // inferred conservatively below the chin and shifted slightly with yaw so
  // the GLB neck remains attached to the torso during head rotation.
  const neckAnchorX = clamp(chin.x + yaw * faceWidth * 0.055, 0, 1)
  const neckAnchorY = clamp(chin.y + faceHeight * 0.2, 0, 1)

  return {
    visible: true,
    centerX: clamp(eyeCenter.x, 0, 1),
    centerY: clamp(eyeCenter.y, 0, 1),
    eyeCenterX: clamp(eyeCenter.x, 0, 1),
    eyeCenterY: clamp(eyeCenter.y, 0, 1),
    eyeDistance,
    faceWidth,
    faceHeight,
    foreheadX: clamp(forehead.x, 0, 1),
    foreheadY: clamp(forehead.y, 0, 1),
    chinX: clamp(chin.x, 0, 1),
    chinY: clamp(chin.y, 0, 1),
    neckAnchorX,
    neckAnchorY,
    roll,
    yaw,
    pitch,
    ...estimateDragonExpression(result),
  }
}

export function smoothStaticDragonPose(
  previous: StaticDragonPoseEstimate | null,
  next: StaticDragonPoseEstimate,
  alpha = 0.32,
): StaticDragonPoseEstimate {
  if (!next.visible || !previous?.visible) return next
  const amount = clamp(alpha, 0, 1)
  const rawExpression = smoothDragonExpression(previous, next, 0.34)
  const expression: DragonExpressionState = {
    jawOpen: stabilizeJaw(previous.jawOpen, rawExpression.jawOpen),
    blinkLeft: stabilizeBlink(previous.blinkLeft, rawExpression.blinkLeft),
    blinkRight: stabilizeBlink(previous.blinkRight, rawExpression.blinkRight),
    gazeX: stableLerp(previous.gazeX, rawExpression.gazeX, 0.25, 0.035, 0.18),
    gazeY: stableLerp(previous.gazeY, rawExpression.gazeY, 0.25, 0.035, 0.18),
    smile: stabilizeSoftExpression(previous.smile, rawExpression.smile),
    browRaise: stabilizeSoftExpression(previous.browRaise, rawExpression.browRaise),
  }

  return {
    visible: true,
    centerX: stableLerp(previous.centerX, next.centerX, amount, 0.0018, 0.018),
    centerY: stableLerp(previous.centerY, next.centerY, amount, 0.0018, 0.018),
    eyeCenterX: stableLerp(previous.eyeCenterX, next.eyeCenterX, amount, 0.0018, 0.018),
    eyeCenterY: stableLerp(previous.eyeCenterY, next.eyeCenterY, amount, 0.0018, 0.018),
    eyeDistance: stableLerp(previous.eyeDistance, next.eyeDistance, amount, 0.0015, 0.015),
    faceWidth: stableLerp(previous.faceWidth, next.faceWidth, amount, 0.0025, 0.022),
    faceHeight: stableLerp(previous.faceHeight, next.faceHeight, amount, 0.0025, 0.022),
    foreheadX: stableLerp(previous.foreheadX, next.foreheadX, amount, 0.002, 0.02),
    foreheadY: stableLerp(previous.foreheadY, next.foreheadY, amount, 0.002, 0.02),
    chinX: stableLerp(previous.chinX, next.chinX, amount, 0.002, 0.02),
    chinY: stableLerp(previous.chinY, next.chinY, amount, 0.002, 0.02),
    neckAnchorX: stableLerp(previous.neckAnchorX, next.neckAnchorX, amount, 0.0022, 0.022),
    neckAnchorY: stableLerp(previous.neckAnchorY, next.neckAnchorY, amount, 0.0022, 0.022),
    roll: stableLerp(previous.roll, next.roll, amount, 0.012, 0.085),
    yaw: stableLerp(previous.yaw, next.yaw, amount, 0.015, 0.1),
    pitch: stableLerp(previous.pitch, next.pitch, amount, 0.015, 0.1),
    ...expression,
  }
}

export function resolveStaticDragonYaw(
  poseYaw: number,
  multiplier: number,
  facingReversed: boolean,
  mirrored: boolean,
): number {
  const baseYaw = facingReversed ? Math.PI : 0
  const modelDirection = facingReversed ? -1 : 1
  const displayDirection = mirrored ? -1 : 1
  return baseYaw + poseYaw * multiplier * modelDirection * displayDirection
}
