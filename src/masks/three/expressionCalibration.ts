import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'

export type DragonExpressionCalibrationPhase = 'neutral' | 'speech' | 'blink' | 'complete'

export interface DragonExpressionMetrics {
  jawOpen: number
  mouthHeight: number
  mouthWidth: number
  leftEyeOpening: number
  rightEyeOpening: number
  leftBlink: number
  rightBlink: number
}

export interface DragonExpressionCalibration {
  version: 1
  jawNeutral: number
  jawSpeech: number
  mouthHeightNeutral: number
  mouthHeightSpeech: number
  mouthWidthNeutral: number
  mouthWidthSpeech: number
  leftEyeOpen: number
  leftEyeClosed: number
  rightEyeOpen: number
  rightEyeClosed: number
  leftBlinkOpen: number
  leftBlinkClosed: number
  rightBlinkOpen: number
  rightBlinkClosed: number
  quality: number
  capturedAt: number
}

export interface DragonExpressionCalibrationCapture {
  accepted: boolean
  phase: DragonExpressionCalibrationPhase
  progress: number
  calibration: DragonExpressionCalibration | null
}

const LANDMARK = {
  forehead: 10,
  chin: 152,
  mouthLeft: 61,
  mouthRight: 291,
  upperLipInner: 13,
  lowerLipInner: 14,
  leftEyeOuter: 33,
  leftEyeInner: 133,
  leftEyeUpperA: 159,
  leftEyeLowerA: 145,
  leftEyeUpperB: 160,
  leftEyeLowerB: 144,
  leftEyeUpperC: 158,
  leftEyeLowerC: 153,
  rightEyeInner: 362,
  rightEyeOuter: 263,
  rightEyeUpperA: 386,
  rightEyeLowerA: 374,
  rightEyeUpperB: 385,
  rightEyeLowerB: 380,
  rightEyeUpperC: 387,
  rightEyeLowerC: 373,
} as const

const NEUTRAL_SAMPLE_TARGET = 24
const SPEECH_SAMPLE_TARGET = 28
const BLINK_SAMPLE_TARGET = 6

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function distance2d(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function percentile(values: number[], amount: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * amount)))
  return sorted[index] ?? 0
}

function scoreMap(result: FaceLandmarkerResult): Map<string, number> {
  const categories = result.faceBlendshapes[0]?.categories ?? []
  return new Map(categories.map((category) => [category.categoryName, clamp(category.score)]))
}

function eyeOpening(
  landmarks: NormalizedLandmark[],
  indices: readonly [number, number, number, number, number, number, number, number],
): number | null {
  const [
    outerIndex,
    innerIndex,
    upperAIndex,
    lowerAIndex,
    upperBIndex,
    lowerBIndex,
    upperCIndex,
    lowerCIndex,
  ] = indices
  const outer = landmarks[outerIndex]
  const inner = landmarks[innerIndex]
  const upperA = landmarks[upperAIndex]
  const lowerA = landmarks[lowerAIndex]
  const upperB = landmarks[upperBIndex]
  const lowerB = landmarks[lowerBIndex]
  const upperC = landmarks[upperCIndex]
  const lowerC = landmarks[lowerCIndex]
  if (!outer || !inner || !upperA || !lowerA || !upperB || !lowerB || !upperC || !lowerC) {
    return null
  }

  const width = distance2d(outer, inner)
  if (!Number.isFinite(width) || width < 0.012) return null

  return (
    distance2d(upperA, lowerA)
    + distance2d(upperB, lowerB)
    + distance2d(upperC, lowerC)
  ) / (3 * width)
}

export function extractDragonExpressionMetrics(
  result: FaceLandmarkerResult | null,
): DragonExpressionMetrics | null {
  const landmarks = result?.faceLandmarks[0]
  if (!result || !landmarks) return null

  const forehead = landmarks[LANDMARK.forehead]
  const chin = landmarks[LANDMARK.chin]
  const mouthLeft = landmarks[LANDMARK.mouthLeft]
  const mouthRight = landmarks[LANDMARK.mouthRight]
  const upperInner = landmarks[LANDMARK.upperLipInner]
  const lowerInner = landmarks[LANDMARK.lowerLipInner]
  if (!forehead || !chin || !mouthLeft || !mouthRight || !upperInner || !lowerInner) {
    return null
  }

  const faceHeight = distance2d(forehead, chin)
  const mouthSpan = distance2d(mouthLeft, mouthRight)
  if (!Number.isFinite(faceHeight) || !Number.isFinite(mouthSpan) || faceHeight < 0.08 || mouthSpan < 0.025) {
    return null
  }

  const leftEyeOpening = eyeOpening(landmarks, [
    LANDMARK.leftEyeOuter,
    LANDMARK.leftEyeInner,
    LANDMARK.leftEyeUpperA,
    LANDMARK.leftEyeLowerA,
    LANDMARK.leftEyeUpperB,
    LANDMARK.leftEyeLowerB,
    LANDMARK.leftEyeUpperC,
    LANDMARK.leftEyeLowerC,
  ])
  const rightEyeOpening = eyeOpening(landmarks, [
    LANDMARK.rightEyeOuter,
    LANDMARK.rightEyeInner,
    LANDMARK.rightEyeUpperA,
    LANDMARK.rightEyeLowerA,
    LANDMARK.rightEyeUpperB,
    LANDMARK.rightEyeLowerB,
    LANDMARK.rightEyeUpperC,
    LANDMARK.rightEyeLowerC,
  ])
  if (leftEyeOpening === null || rightEyeOpening === null) return null

  const scores = scoreMap(result)
  // Landmarks 13/14 represent the actual inner lip aperture. The previous
  // outer-lip fallback measured lip thickness as if it were an open mouth,
  // which produced large false openings with closed lips on some faces.
  const innerGap = distance2d(upperInner, lowerInner)

  return {
    jawOpen: scores.get('jawOpen') ?? 0,
    mouthHeight: innerGap / faceHeight,
    mouthWidth: innerGap / mouthSpan,
    leftEyeOpening,
    rightEyeOpening,
    leftBlink: scores.get('eyeBlinkLeft') ?? 0,
    rightBlink: scores.get('eyeBlinkRight') ?? 0,
  }
}

function neutralMetrics(samples: DragonExpressionMetrics[]): DragonExpressionMetrics {
  return {
    jawOpen: percentile(samples.map((sample) => sample.jawOpen), 0.5),
    mouthHeight: percentile(samples.map((sample) => sample.mouthHeight), 0.5),
    mouthWidth: percentile(samples.map((sample) => sample.mouthWidth), 0.5),
    leftEyeOpening: percentile(samples.map((sample) => sample.leftEyeOpening), 0.65),
    rightEyeOpening: percentile(samples.map((sample) => sample.rightEyeOpening), 0.65),
    leftBlink: percentile(samples.map((sample) => sample.leftBlink), 0.35),
    rightBlink: percentile(samples.map((sample) => sample.rightBlink), 0.35),
  }
}

function geometryClosure(opening: number, openReference: number): number {
  const minimumRange = Math.max(0.025, openReference * 0.62)
  return clamp((openReference - opening) / minimumRange)
}

function blendshapeClosure(blink: number, openReference: number): number {
  return clamp((blink - openReference) / Math.max(0.28, 0.92 - openReference))
}

function hasRealBilateralClosure(
  metrics: DragonExpressionMetrics,
  neutral: DragonExpressionMetrics,
): boolean {
  const leftGeometry = geometryClosure(metrics.leftEyeOpening, neutral.leftEyeOpening)
  const rightGeometry = geometryClosure(metrics.rightEyeOpening, neutral.rightEyeOpening)
  const leftBlendshape = blendshapeClosure(metrics.leftBlink, neutral.leftBlink)
  const rightBlendshape = blendshapeClosure(metrics.rightBlink, neutral.rightBlink)

  const leftClosed = leftGeometry >= 0.34
    || (leftGeometry >= 0.2 && leftBlendshape >= 0.42)
  const rightClosed = rightGeometry >= 0.34
    || (rightGeometry >= 0.2 && rightBlendshape >= 0.42)

  return leftClosed && rightClosed
}

function createCalibration(
  neutralSamples: DragonExpressionMetrics[],
  speechSamples: DragonExpressionMetrics[],
  blinkSamples: DragonExpressionMetrics[],
  capturedAt = Date.now(),
): DragonExpressionCalibration {
  const neutral = neutralMetrics(neutralSamples)
  const jawSpeech = Math.max(
    neutral.jawOpen + 0.025,
    percentile(speechSamples.map((sample) => sample.jawOpen), 0.9),
  )
  const mouthHeightSpeech = Math.max(
    neutral.mouthHeight + 0.01,
    percentile(speechSamples.map((sample) => sample.mouthHeight), 0.9),
  )
  const mouthWidthSpeech = Math.max(
    neutral.mouthWidth + 0.035,
    percentile(speechSamples.map((sample) => sample.mouthWidth), 0.9),
  )
  const leftEyeClosed = Math.min(
    neutral.leftEyeOpening * 0.72,
    percentile(blinkSamples.map((sample) => sample.leftEyeOpening), 0.18),
  )
  const rightEyeClosed = Math.min(
    neutral.rightEyeOpening * 0.72,
    percentile(blinkSamples.map((sample) => sample.rightEyeOpening), 0.18),
  )
  const leftBlinkClosed = Math.max(
    neutral.leftBlink + 0.22,
    percentile(blinkSamples.map((sample) => sample.leftBlink), 0.82),
  )
  const rightBlinkClosed = Math.max(
    neutral.rightBlink + 0.22,
    percentile(blinkSamples.map((sample) => sample.rightBlink), 0.82),
  )

  const speechQuality = clamp(Math.max(
    (jawSpeech - neutral.jawOpen) / 0.12,
    (mouthHeightSpeech - neutral.mouthHeight) / 0.035,
    (mouthWidthSpeech - neutral.mouthWidth) / 0.12,
  ))
  const leftGeometryQuality = clamp(
    (neutral.leftEyeOpening - leftEyeClosed) / Math.max(0.035, neutral.leftEyeOpening * 0.62),
  )
  const rightGeometryQuality = clamp(
    (neutral.rightEyeOpening - rightEyeClosed) / Math.max(0.035, neutral.rightEyeOpening * 0.62),
  )
  const leftSignalQuality = clamp((leftBlinkClosed - neutral.leftBlink) / 0.55)
  const rightSignalQuality = clamp((rightBlinkClosed - neutral.rightBlink) / 0.55)
  const leftBlinkQuality = leftGeometryQuality * 0.72 + leftSignalQuality * 0.28
  const rightBlinkQuality = rightGeometryQuality * 0.72 + rightSignalQuality * 0.28

  return {
    version: 1,
    jawNeutral: neutral.jawOpen,
    jawSpeech,
    mouthHeightNeutral: neutral.mouthHeight,
    mouthHeightSpeech,
    mouthWidthNeutral: neutral.mouthWidth,
    mouthWidthSpeech,
    leftEyeOpen: neutral.leftEyeOpening,
    leftEyeClosed,
    rightEyeOpen: neutral.rightEyeOpening,
    rightEyeClosed,
    leftBlinkOpen: neutral.leftBlink,
    leftBlinkClosed,
    rightBlinkOpen: neutral.rightBlink,
    rightBlinkClosed,
    quality: clamp((speechQuality * 1.2 + leftBlinkQuality * 1.1 + rightBlinkQuality * 1.1) / 3.4),
    capturedAt,
  }
}

export class DragonExpressionCalibrator {
  private running = false
  private currentPhase: DragonExpressionCalibrationPhase = 'neutral'
  private neutralSamples: DragonExpressionMetrics[] = []
  private speechSamples: DragonExpressionMetrics[] = []
  private blinkSamples: DragonExpressionMetrics[] = []

  get active(): boolean {
    return this.running
  }

  get phase(): DragonExpressionCalibrationPhase {
    return this.currentPhase
  }

  get progress(): number {
    if (!this.running && this.currentPhase === 'complete') return 1
    if (this.currentPhase === 'neutral') return this.neutralSamples.length / NEUTRAL_SAMPLE_TARGET / 3
    if (this.currentPhase === 'speech') return (1 + this.speechSamples.length / SPEECH_SAMPLE_TARGET) / 3
    if (this.currentPhase === 'blink') return (2 + this.blinkSamples.length / BLINK_SAMPLE_TARGET) / 3
    return 1
  }

  start(): void {
    this.running = true
    this.currentPhase = 'neutral'
    this.neutralSamples = []
    this.speechSamples = []
    this.blinkSamples = []
  }

  cancel(): void {
    this.running = false
    this.currentPhase = 'neutral'
    this.neutralSamples = []
    this.speechSamples = []
    this.blinkSamples = []
  }

  capture(result: FaceLandmarkerResult | null): DragonExpressionCalibrationCapture {
    if (!this.running) {
      return { accepted: false, phase: this.currentPhase, progress: this.progress, calibration: null }
    }

    const metrics = extractDragonExpressionMetrics(result)
    if (!metrics) {
      return { accepted: false, phase: this.currentPhase, progress: this.progress, calibration: null }
    }

    if (this.currentPhase === 'neutral') {
      const eyesOpen = metrics.leftEyeOpening > 0.055
        && metrics.rightEyeOpening > 0.055
        && metrics.leftBlink < 0.38
        && metrics.rightBlink < 0.38
      const expressionNeutral = metrics.jawOpen < 0.45
      if (!eyesOpen || !expressionNeutral) {
        return { accepted: false, phase: this.currentPhase, progress: this.progress, calibration: null }
      }

      this.neutralSamples.push(metrics)
      if (this.neutralSamples.length >= NEUTRAL_SAMPLE_TARGET) this.currentPhase = 'speech'
      return { accepted: true, phase: this.currentPhase, progress: this.progress, calibration: null }
    }

    const neutral = neutralMetrics(this.neutralSamples)
    if (this.currentPhase === 'speech') {
      const speechActivity = Math.max(
        (metrics.jawOpen - neutral.jawOpen) / 0.025,
        (metrics.mouthHeight - neutral.mouthHeight) / 0.008,
        (metrics.mouthWidth - neutral.mouthWidth) / 0.028,
      )
      if (speechActivity < 0.45) {
        return { accepted: false, phase: this.currentPhase, progress: this.progress, calibration: null }
      }

      this.speechSamples.push(metrics)
      if (this.speechSamples.length >= SPEECH_SAMPLE_TARGET) this.currentPhase = 'blink'
      return { accepted: true, phase: this.currentPhase, progress: this.progress, calibration: null }
    }

    if (this.currentPhase === 'blink') {
      if (!hasRealBilateralClosure(metrics, neutral)) {
        return { accepted: false, phase: this.currentPhase, progress: this.progress, calibration: null }
      }

      this.blinkSamples.push(metrics)
      if (this.blinkSamples.length < BLINK_SAMPLE_TARGET) {
        return { accepted: true, phase: this.currentPhase, progress: this.progress, calibration: null }
      }

      const calibration = createCalibration(
        this.neutralSamples,
        this.speechSamples,
        this.blinkSamples,
      )
      this.running = false
      this.currentPhase = 'complete'
      return { accepted: true, phase: 'complete', progress: 1, calibration }
    }

    return { accepted: false, phase: this.currentPhase, progress: this.progress, calibration: null }
  }
}
