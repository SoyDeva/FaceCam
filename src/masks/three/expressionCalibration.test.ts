import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import { DragonExpressionCalibrator } from './expressionCalibration'

function landmark(x: number, y: number, z = 0): NormalizedLandmark {
  return { x, y, z, visibility: 1 }
}

function resultFor(
  jawOpen: number,
  mouthGap: number,
  leftEyeOpening: number,
  rightEyeOpening: number,
  leftBlink: number,
  rightBlink: number,
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

  const leftEyeGap = leftEyeOpening * 0.08
  landmarks[33] = landmark(0.35, 0.42)
  landmarks[133] = landmark(0.43, 0.42)
  landmarks[159] = landmark(0.39, 0.42 - leftEyeGap / 2)
  landmarks[145] = landmark(0.39, 0.42 + leftEyeGap / 2)
  landmarks[160] = landmark(0.38, 0.42 - leftEyeGap / 2)
  landmarks[144] = landmark(0.38, 0.42 + leftEyeGap / 2)
  landmarks[158] = landmark(0.4, 0.42 - leftEyeGap / 2)
  landmarks[153] = landmark(0.4, 0.42 + leftEyeGap / 2)

  const rightEyeGap = rightEyeOpening * 0.08
  landmarks[362] = landmark(0.57, 0.42)
  landmarks[263] = landmark(0.65, 0.42)
  landmarks[386] = landmark(0.61, 0.42 - rightEyeGap / 2)
  landmarks[374] = landmark(0.61, 0.42 + rightEyeGap / 2)
  landmarks[385] = landmark(0.6, 0.42 - rightEyeGap / 2)
  landmarks[380] = landmark(0.6, 0.42 + rightEyeGap / 2)
  landmarks[387] = landmark(0.62, 0.42 - rightEyeGap / 2)
  landmarks[373] = landmark(0.62, 0.42 + rightEyeGap / 2)

  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [{
      categories: [
        { categoryName: 'jawOpen', score: jawOpen, index: 0, displayName: '' },
        { categoryName: 'eyeBlinkLeft', score: leftBlink, index: 1, displayName: '' },
        { categoryName: 'eyeBlinkRight', score: rightBlink, index: 2, displayName: '' },
      ],
      headIndex: 0,
      headName: '',
    }],
    facialTransformationMatrixes: [],
  } as unknown as FaceLandmarkerResult
}

function openNeutral(): FaceLandmarkerResult {
  return resultFor(0.04, 0.012, 0.14, 0.14, 0.03, 0.03)
}

function speech(): FaceLandmarkerResult {
  return resultFor(0.13, 0.03, 0.14, 0.14, 0.03, 0.03)
}

function bothEyesClosed(): FaceLandmarkerResult {
  return resultFor(0.04, 0.012, 0.035, 0.035, 0.82, 0.82)
}

function advanceToBlink(calibrator: DragonExpressionCalibrator): void {
  for (let index = 0; index < 24; index += 1) calibrator.capture(openNeutral())
  for (let index = 0; index < 28; index += 1) calibrator.capture(speech())
  expect(calibrator.phase).toBe('blink')
}

describe('DragonExpressionCalibrator', () => {
  it('captures open eyes and requires real bilateral closure', () => {
    const calibrator = new DragonExpressionCalibrator()
    calibrator.start()
    advanceToBlink(calibrator)

    let calibration = null
    for (let index = 0; index < 12; index += 1) {
      calibration = calibrator.capture(bothEyesClosed()).calibration
    }

    expect(calibrator.active).toBe(false)
    expect(calibrator.phase).toBe('complete')
    expect(calibration).not.toBeNull()
    expect(calibration?.jawSpeech).toBeGreaterThan(calibration?.jawNeutral ?? 1)
    expect(calibration?.leftEyeOpen).toBeGreaterThan(calibration?.leftEyeClosed ?? 1)
    expect(calibration?.rightEyeOpen).toBeGreaterThan(calibration?.rightEyeClosed ?? 1)
    expect(calibration?.leftBlinkClosed).toBeGreaterThan(calibration?.leftBlinkOpen ?? 1)
    expect(calibration?.rightBlinkClosed).toBeGreaterThan(calibration?.rightBlinkOpen ?? 1)
    expect(calibration?.quality).toBeGreaterThan(0.5)
  })

  it('does not advance speech while the user remains neutral', () => {
    const calibrator = new DragonExpressionCalibrator()
    calibrator.start()
    for (let index = 0; index < 24; index += 1) calibrator.capture(openNeutral())
    for (let index = 0; index < 40; index += 1) calibrator.capture(openNeutral())

    expect(calibrator.phase).toBe('speech')
    expect(calibrator.progress).toBeCloseTo(1 / 3)
  })

  it('rejects open-mouth frames during the neutral open-eye phase', () => {
    const calibrator = new DragonExpressionCalibrator()
    calibrator.start()
    const capture = calibrator.capture(
      resultFor(0.7, 0.05, 0.14, 0.14, 0.03, 0.03),
    )

    expect(capture.accepted).toBe(false)
    expect(capture.progress).toBe(0)
  })

  it('does not count a wink or eyebrow signal as both eyes closed', () => {
    const calibrator = new DragonExpressionCalibrator()
    calibrator.start()
    advanceToBlink(calibrator)

    for (let index = 0; index < 20; index += 1) {
      const capture = calibrator.capture(
        resultFor(0.04, 0.012, 0.035, 0.14, 0.9, 0.9),
      )
      expect(capture.accepted).toBe(false)
    }

    expect(calibrator.phase).toBe('blink')
    expect(calibrator.progress).toBeCloseTo(2 / 3)
  })

  it('rejects closed-eye blendshapes when eye geometry stays open', () => {
    const calibrator = new DragonExpressionCalibrator()
    calibrator.start()
    advanceToBlink(calibrator)

    const capture = calibrator.capture(
      resultFor(0.04, 0.012, 0.14, 0.14, 0.95, 0.95),
    )

    expect(capture.accepted).toBe(false)
    expect(calibrator.progress).toBeCloseTo(2 / 3)
  })
})
