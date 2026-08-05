import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import { DragonExpressionCalibrator } from './expressionCalibration'

function landmark(x: number, y: number, z = 0): NormalizedLandmark {
  return { x, y, z, visibility: 1 }
}

function resultFor(
  jawOpen: number,
  mouthGap: number,
  eyeOpening: number,
  blink: number,
): FaceLandmarkerResult {
  const landmarks = Array.from({ length: 478 }, () => landmark(0.5, 0.5))
  landmarks[10] = landmark(0.5, 0.2)
  landmarks[152] = landmark(0.5, 0.8)
  landmarks[61] = landmark(0.42, 0.56)
  landmarks[291] = landmark(0.58, 0.56)
  landmarks[13] = landmark(0.5, 0.56 - mouthGap / 2)
  landmarks[14] = landmark(0.5, 0.56 + mouthGap / 2)
  landmarks[0] = landmark(0.5, 0.56 - mouthGap / 2)
  landmarks[17] = landmark(0.5, 0.56 + mouthGap / 2)

  const eyeGap = eyeOpening * 0.08
  landmarks[33] = landmark(0.35, 0.42)
  landmarks[133] = landmark(0.43, 0.42)
  landmarks[159] = landmark(0.39, 0.42 - eyeGap / 2)
  landmarks[145] = landmark(0.39, 0.42 + eyeGap / 2)
  landmarks[160] = landmark(0.38, 0.42 - eyeGap / 2)
  landmarks[144] = landmark(0.38, 0.42 + eyeGap / 2)
  landmarks[158] = landmark(0.4, 0.42 - eyeGap / 2)
  landmarks[153] = landmark(0.4, 0.42 + eyeGap / 2)
  landmarks[362] = landmark(0.57, 0.42)
  landmarks[263] = landmark(0.65, 0.42)
  landmarks[386] = landmark(0.61, 0.42 - eyeGap / 2)
  landmarks[374] = landmark(0.61, 0.42 + eyeGap / 2)
  landmarks[385] = landmark(0.6, 0.42 - eyeGap / 2)
  landmarks[380] = landmark(0.6, 0.42 + eyeGap / 2)
  landmarks[387] = landmark(0.62, 0.42 - eyeGap / 2)
  landmarks[373] = landmark(0.62, 0.42 + eyeGap / 2)

  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [{
      categories: [
        { categoryName: 'jawOpen', score: jawOpen, index: 0, displayName: '' },
        { categoryName: 'eyeBlinkLeft', score: blink, index: 1, displayName: '' },
        { categoryName: 'eyeBlinkRight', score: blink, index: 2, displayName: '' },
      ],
      headIndex: 0,
      headName: '',
    }],
    facialTransformationMatrixes: [],
  } as unknown as FaceLandmarkerResult
}

describe('DragonExpressionCalibrator', () => {
  it('requires explicit neutral, speech and blink phases', () => {
    const calibrator = new DragonExpressionCalibrator()
    calibrator.start()

    for (let index = 0; index < 24; index += 1) {
      calibrator.capture(resultFor(0.04 + index % 2 * 0.002, 0.012, 0.14, 0.03))
    }
    expect(calibrator.phase).toBe('speech')

    for (let index = 0; index < 28; index += 1) {
      calibrator.capture(resultFor(0.12 + index % 3 * 0.005, 0.03, 0.14, 0.03))
    }
    expect(calibrator.phase).toBe('blink')

    let calibration = null
    for (let index = 0; index < 8; index += 1) {
      calibration = calibrator.capture(resultFor(0.04, 0.012, 0.035, 0.82)).calibration
    }

    expect(calibrator.active).toBe(false)
    expect(calibrator.phase).toBe('complete')
    expect(calibration).not.toBeNull()
    expect(calibration?.jawSpeech).toBeGreaterThan(calibration?.jawNeutral ?? 1)
    expect(calibration?.leftEyeOpen).toBeGreaterThan(calibration?.leftEyeClosed ?? 1)
    expect(calibration?.quality).toBeGreaterThan(0.5)
  })

  it('does not advance speech while the user remains neutral', () => {
    const calibrator = new DragonExpressionCalibrator()
    calibrator.start()
    for (let index = 0; index < 24; index += 1) {
      calibrator.capture(resultFor(0.04, 0.012, 0.14, 0.03))
    }
    for (let index = 0; index < 40; index += 1) {
      calibrator.capture(resultFor(0.042, 0.0125, 0.14, 0.03))
    }

    expect(calibrator.phase).toBe('speech')
    expect(calibrator.progress).toBeCloseTo(1 / 3)
  })

  it('rejects open-mouth frames during the neutral phase', () => {
    const calibrator = new DragonExpressionCalibrator()
    calibrator.start()
    const capture = calibrator.capture(resultFor(0.7, 0.05, 0.14, 0.03))

    expect(capture.accepted).toBe(false)
    expect(capture.progress).toBe(0)
  })
})
