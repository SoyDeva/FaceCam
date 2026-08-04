import type { StaticDragonPoseEstimate } from './staticPose'

export interface StaticDragonHeadCalibration {
  version: 1
  baseFaceWidth: number
  baseEyeDistance: number
  baseFaceHeight: number
  capturedAt: number
}

export interface HeadCalibrationCapture {
  accepted: boolean
  progress: number
  calibration: StaticDragonHeadCalibration | null
}

export const HEAD_CALIBRATION_SAMPLE_TARGET = 24
const MINIMUM_CALIBRATION_SAMPLES = 12

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

export function isStableFrontalHeadPose(pose: StaticDragonPoseEstimate): boolean {
  return pose.visible
    && Number.isFinite(pose.faceWidth)
    && Number.isFinite(pose.eyeDistance)
    && Number.isFinite(pose.faceHeight)
    && pose.faceWidth >= 0.08
    && pose.eyeDistance >= 0.025
    && pose.faceHeight >= 0.1
    && Math.abs(pose.yaw) <= 0.2
    && Math.abs(pose.pitch) <= 0.2
    && Math.abs(pose.roll) <= 0.16
}

export function createStaticDragonHeadCalibration(
  samples: StaticDragonPoseEstimate[],
  capturedAt = Date.now(),
): StaticDragonHeadCalibration {
  const validSamples = samples.filter(isStableFrontalHeadPose)
  if (validSamples.length < MINIMUM_CALIBRATION_SAMPLES) {
    throw new Error('No hubo suficientes fotogramas frontales estables para calibrar la cabeza.')
  }

  return {
    version: 1,
    baseFaceWidth: median(validSamples.map((sample) => sample.faceWidth)),
    baseEyeDistance: median(validSamples.map((sample) => sample.eyeDistance)),
    baseFaceHeight: median(validSamples.map((sample) => sample.faceHeight)),
    capturedAt,
  }
}

export class StaticDragonHeadCalibrator {
  private samples: StaticDragonPoseEstimate[] = []
  private running = false

  get active(): boolean {
    return this.running
  }

  get progress(): number {
    return Math.min(1, this.samples.length / HEAD_CALIBRATION_SAMPLE_TARGET)
  }

  start(): void {
    this.samples = []
    this.running = true
  }

  cancel(): void {
    this.samples = []
    this.running = false
  }

  capture(pose: StaticDragonPoseEstimate): HeadCalibrationCapture {
    if (!this.running || !isStableFrontalHeadPose(pose)) {
      return { accepted: false, progress: this.progress, calibration: null }
    }

    this.samples.push({ ...pose })
    if (this.samples.length < HEAD_CALIBRATION_SAMPLE_TARGET) {
      return { accepted: true, progress: this.progress, calibration: null }
    }

    const calibration = createStaticDragonHeadCalibration(this.samples)
    this.running = false
    return { accepted: true, progress: 1, calibration }
  }
}
