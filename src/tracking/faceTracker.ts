import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision'

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null
  private lastTimestamp = -1

  async initialize(): Promise<void> {
    if (this.landmarker) return

    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT)
    const commonOptions = {
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    }

    try {
      this.landmarker = await FaceLandmarker.createFromOptions(vision, {
        ...commonOptions,
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: 'GPU',
        },
      })
    } catch (gpuError) {
      console.warn('MediaPipe GPU no está disponible; usando CPU.', gpuError)
      this.landmarker = await FaceLandmarker.createFromOptions(vision, {
        ...commonOptions,
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: 'CPU',
        },
      })
    }
  }

  detect(video: HTMLVideoElement, timestampMs: number): FaceLandmarkerResult | null {
    if (!this.landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null
    if (timestampMs <= this.lastTimestamp) return null
    this.lastTimestamp = timestampMs
    return this.landmarker.detectForVideo(video, timestampMs)
  }

  close(): void {
    this.landmarker?.close()
    this.landmarker = null
  }
}
