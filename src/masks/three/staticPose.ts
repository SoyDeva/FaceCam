import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'

export interface StaticDragonPoseEstimate {
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
  }
}

export function smoothStaticDragonPose(
  previous: StaticDragonPoseEstimate | null,
  next: StaticDragonPoseEstimate,
  alpha = 0.32,
): StaticDragonPoseEstimate {
  if (!next.visible || !previous?.visible) return next
  const amount = clamp(alpha, 0, 1)

  return {
    visible: true,
    centerX: lerp(previous.centerX, next.centerX, amount),
    centerY: lerp(previous.centerY, next.centerY, amount),
    eyeCenterX: lerp(previous.eyeCenterX, next.eyeCenterX, amount),
    eyeCenterY: lerp(previous.eyeCenterY, next.eyeCenterY, amount),
    eyeDistance: lerp(previous.eyeDistance, next.eyeDistance, amount),
    faceWidth: lerp(previous.faceWidth, next.faceWidth, amount),
    faceHeight: lerp(previous.faceHeight, next.faceHeight, amount),
    foreheadX: lerp(previous.foreheadX, next.foreheadX, amount),
    foreheadY: lerp(previous.foreheadY, next.foreheadY, amount),
    chinX: lerp(previous.chinX, next.chinX, amount),
    chinY: lerp(previous.chinY, next.chinY, amount),
    neckAnchorX: lerp(previous.neckAnchorX, next.neckAnchorX, amount),
    neckAnchorY: lerp(previous.neckAnchorY, next.neckAnchorY, amount),
    roll: lerp(previous.roll, next.roll, amount),
    yaw: lerp(previous.yaw, next.yaw, amount),
    pitch: lerp(previous.pitch, next.pitch, amount),
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
