import { describe, expect, it } from 'vitest'
import { NEUTRAL_DRAGON_EXPRESSION } from './dragonExpressions'
import type { StaticDragonHeadCalibration } from './headCalibration'
import {
  MonocularHeadDistanceModel,
  estimateMonocularHeadScale,
} from './headDistance'
import type { StaticDragonPoseEstimate } from './staticPose'

const calibration: StaticDragonHeadCalibration = {
  version: 1,
  baseFaceWidth: 0.4,
  baseEyeDistance: 0.2,
  baseFaceHeight: 0.6,
  capturedAt: 1,
}

function pose(patch: Partial<StaticDragonPoseEstimate> = {}): StaticDragonPoseEstimate {
  return {
    visible: true,
    centerX: 0.5,
    centerY: 0.42,
    eyeCenterX: 0.5,
    eyeCenterY: 0.42,
    eyeDistance: 0.2,
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
    ...NEUTRAL_DRAGON_EXPRESSION,
    ...patch,
  }
}

describe('estimateMonocularHeadScale', () => {
  it('returns the calibrated scale for the reference pose', () => {
    expect(estimateMonocularHeadScale(pose(), calibration).scale).toBeCloseTo(1)
  })

  it('grows when the user moves closer', () => {
    const estimate = estimateMonocularHeadScale(pose({
      eyeDistance: 0.27,
      faceWidth: 0.54,
      faceHeight: 0.81,
    }), calibration)

    expect(estimate.scale).toBeGreaterThan(1.25)
    expect(estimate.relativeDistance).toBeLessThan(0.8)
  })

  it('does not shrink merely because the head turns', () => {
    const yaw = 0.65
    const projection = Math.cos(yaw)
    const estimate = estimateMonocularHeadScale(pose({
      yaw,
      eyeDistance: calibration.baseEyeDistance * projection,
      faceWidth: calibration.baseFaceWidth * projection,
    }), calibration)

    expect(estimate.scale).toBeGreaterThan(0.94)
    expect(estimate.scale).toBeLessThan(1.06)
  })
})

describe('MonocularHeadDistanceModel', () => {
  it('smooths abrupt distance changes', () => {
    const model = new MonocularHeadDistanceModel()
    model.update(pose(), calibration)
    const next = model.update(pose({
      eyeDistance: 0.35,
      faceWidth: 0.7,
      faceHeight: 1.05,
    }), calibration)

    expect(next.scale).toBeGreaterThan(1)
    expect(next.scale).toBeLessThan(1.2)
  })
})
