import { describe, expect, it } from 'vitest'
import {
  HEAD_CALIBRATION_SAMPLE_TARGET,
  StaticDragonHeadCalibrator,
  createStaticDragonHeadCalibration,
  isStableFrontalHeadPose,
} from './headCalibration'
import type { StaticDragonPoseEstimate } from './staticPose'

function pose(patch: Partial<StaticDragonPoseEstimate> = {}): StaticDragonPoseEstimate {
  return {
    visible: true,
    centerX: 0.5,
    centerY: 0.42,
    eyeCenterX: 0.5,
    eyeCenterY: 0.42,
    eyeDistance: 0.16,
    faceWidth: 0.4,
    faceHeight: 0.6,
    foreheadX: 0.5,
    foreheadY: 0.2,
    chinX: 0.5,
    chinY: 0.8,
    neckAnchorX: 0.5,
    neckAnchorY: 0.92,
    roll: 0,
    yaw: 0,
    pitch: 0,
    ...patch,
  }
}

describe('head calibration', () => {
  it('accepts only stable frontal samples', () => {
    expect(isStableFrontalHeadPose(pose())).toBe(true)
    expect(isStableFrontalHeadPose(pose({ yaw: 0.4 }))).toBe(false)
    expect(isStableFrontalHeadPose(pose({ visible: false }))).toBe(false)
  })

  it('uses robust median measurements', () => {
    const samples = Array.from({ length: 12 }, (_, index) => pose({
      faceWidth: index === 11 ? 0.9 : 0.4,
      eyeDistance: 0.16,
      faceHeight: 0.6,
    }))
    const calibration = createStaticDragonHeadCalibration(samples, 123)

    expect(calibration.baseFaceWidth).toBeCloseTo(0.4)
    expect(calibration.baseEyeDistance).toBeCloseTo(0.16)
    expect(calibration.baseFaceHeight).toBeCloseTo(0.6)
    expect(calibration.capturedAt).toBe(123)
  })

  it('locks calibration after the target number of samples', () => {
    const calibrator = new StaticDragonHeadCalibrator()
    calibrator.start()

    let completed = null
    for (let index = 0; index < HEAD_CALIBRATION_SAMPLE_TARGET; index += 1) {
      completed = calibrator.capture(pose()).calibration
    }

    expect(completed).not.toBeNull()
    expect(calibrator.active).toBe(false)
  })
})
