import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'

export interface StaticDragonPoseEstimate {
  visible: boolean
  centerX: number
  centerY: number
  faceWidth: number
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
  rightEyeOuter: 263,
  noseTip: 1,
} as const

function invisiblePose(): StaticDragonPoseEstimate {
  return {
    visible: false,
    centerX: 0.5,
    centerY: 0.5,
    faceWidth: 0,
    roll: 0,
    yaw: 0,
    pitch: 0,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function distance2d(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
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
  const leftEye = landmarks[LANDMARK.leftEyeOuter]
  const rightEye = landmarks[LANDMARK.rightEyeOuter]
  const nose = landmarks[LANDMARK.noseTip]

  if (!forehead || !chin || !leftTemple || !rightTemple || !leftEye || !rightEye || !nose) {
    return invisiblePose()
  }

  const faceWidth = distance2d(leftTemple, rightTemple)
  const faceHeight = Math.max(0.001, distance2d(forehead, chin))
  if (!Number.isFinite(faceWidth) || faceWidth < 0.025) return invisiblePose()

  const eyeMidX = (leftEye.x + rightEye.x) / 2
  const headCenterY = forehead.y + faceHeight * 0.53
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x)

  // MediaPipe z is relative to the head scale. Temple depth difference is a
  // stable, expression-independent approximation for horizontal rotation.
  const yaw = clamp((leftTemple.z - rightTemple.z) / faceWidth * 1.35, -0.95, 0.95)

  // Nose position inside the forehead/chin span provides a conservative pitch
  // estimate. Keeping the gain low avoids jaw expressions driving the head.
  const noseRatio = (nose.y - forehead.y) / faceHeight
  const pitch = clamp((noseRatio - 0.5) * 1.45, -0.55, 0.55)

  return {
    visible: true,
    centerX: clamp((eyeMidX + (leftTemple.x + rightTemple.x) / 2) / 2, 0, 1),
    centerY: clamp(headCenterY, 0, 1),
    faceWidth,
    roll,
    yaw,
    pitch,
  }
}
