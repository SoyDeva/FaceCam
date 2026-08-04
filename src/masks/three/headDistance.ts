import type { StaticDragonHeadCalibration } from './headCalibration'
import type { StaticDragonPoseEstimate } from './staticPose'

export interface MonocularHeadDistanceEstimate {
  /** Screen-space scale relative to the frontal calibration. */
  scale: number
  /** Relative camera distance where 1 is the calibrated distance. */
  relativeDistance: number
  confidence: number
}

const MIN_SCALE = 0.58
const MAX_SCALE = 1.85
const MAX_STEP_PER_FRAME = 0.035

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function safeRatio(value: number, baseline: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(baseline) || baseline <= 0) return 1
  return clamp(value / baseline, 0.42, 2.4)
}

function weightedGeometricMean(values: Array<{ value: number; weight: number }>): number {
  let logarithmicTotal = 0
  let weightTotal = 0

  for (const item of values) {
    if (!Number.isFinite(item.value) || item.value <= 0 || item.weight <= 0) continue
    logarithmicTotal += Math.log(item.value) * item.weight
    weightTotal += item.weight
  }

  return weightTotal > 0 ? Math.exp(logarithmicTotal / weightTotal) : 1
}

export function estimateMonocularHeadScale(
  pose: StaticDragonPoseEstimate,
  calibration: StaticDragonHeadCalibration,
): MonocularHeadDistanceEstimate {
  if (!pose.visible) {
    return { scale: 1, relativeDistance: 1, confidence: 0 }
  }

  const yawMagnitude = Math.abs(pose.yaw)
  const pitchMagnitude = Math.abs(pose.pitch)
  const yawProjection = Math.max(0.58, Math.cos(yawMagnitude))
  const pitchProjection = Math.max(0.7, Math.cos(pitchMagnitude))

  // Eye distance and temple width shrink when the head turns. Correcting the
  // projection prevents profile rotation from being interpreted as movement
  // away from the camera. Face height provides an independent depth signal.
  const eyeRatio = safeRatio(
    pose.eyeDistance / yawProjection,
    calibration.baseEyeDistance,
  )
  const widthRatio = safeRatio(
    pose.faceWidth / yawProjection,
    calibration.baseFaceWidth,
  )
  const heightRatio = safeRatio(
    pose.faceHeight / pitchProjection,
    calibration.baseFaceHeight,
  )

  const yawReliability = clamp(1 - yawMagnitude / 0.9, 0, 1)
  const pitchReliability = clamp(1 - pitchMagnitude / 0.58, 0, 1)
  const confidence = clamp(0.18 + yawReliability * 0.58 + pitchReliability * 0.24, 0, 1)

  const rawScale = weightedGeometricMean([
    { value: eyeRatio, weight: 0.18 + yawReliability * 0.42 },
    { value: widthRatio, weight: 0.08 + yawReliability * 0.22 },
    { value: heightRatio, weight: 0.32 + (1 - yawReliability) * 0.35 },
  ])

  const scale = clamp(rawScale, MIN_SCALE, MAX_SCALE)
  return {
    scale,
    relativeDistance: 1 / scale,
    confidence,
  }
}

/**
 * AI-assisted monocular distance model. MediaPipe supplies learned facial
 * landmarks and relative depth; this temporal model converts those signals
 * into a stable screen scale without requiring camera intrinsics or cloud IO.
 */
export class MonocularHeadDistanceModel {
  private currentScale = 1
  private initialized = false
  private calibrationTimestamp = 0

  reset(calibration?: StaticDragonHeadCalibration | null): void {
    this.currentScale = 1
    this.initialized = false
    this.calibrationTimestamp = calibration?.capturedAt ?? 0
  }

  update(
    pose: StaticDragonPoseEstimate,
    calibration: StaticDragonHeadCalibration,
  ): MonocularHeadDistanceEstimate {
    if (this.calibrationTimestamp !== calibration.capturedAt) {
      this.reset(calibration)
    }

    const estimate = estimateMonocularHeadScale(pose, calibration)
    if (!pose.visible) {
      return {
        scale: this.currentScale,
        relativeDistance: 1 / this.currentScale,
        confidence: 0,
      }
    }

    if (!this.initialized) {
      this.currentScale = estimate.scale
      this.initialized = true
      return estimate
    }

    // Extreme profiles are poor monocular rulers. Keep responding slowly
    // instead of allowing the dragon to collapse or inflate during a turn.
    const alpha = estimate.confidence >= 0.7 ? 0.17 : estimate.confidence >= 0.42 ? 0.09 : 0.035
    const deadBand = Math.abs(estimate.scale - this.currentScale) < 0.012
    const target = deadBand ? this.currentScale : estimate.scale
    const desiredStep = (target - this.currentScale) * alpha
    const step = clamp(desiredStep, -MAX_STEP_PER_FRAME, MAX_STEP_PER_FRAME)
    this.currentScale = clamp(this.currentScale + step, MIN_SCALE, MAX_SCALE)

    return {
      scale: this.currentScale,
      relativeDistance: 1 / this.currentScale,
      confidence: estimate.confidence,
    }
  }
}
