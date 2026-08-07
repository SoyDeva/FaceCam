import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision'
import {
  eyeRigDiagnosticFrame,
  eyeSignalSnapshot,
  overrideEyeBlinkScores,
} from './eyeRigDiagnostic'

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null
  private lastTimestamp = -1
  private diagnosticStartedAt = -1
  private diagnosticPanel: HTMLDivElement | null = null
  private readonly diagnosticEnabled = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('eyeRigTest') === '1'
  private readonly liveDebugEnabled = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('faceDebug') === '1'

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

    const result = this.landmarker.detectForVideo(video, timestampMs)
    if ((!this.diagnosticEnabled && !this.liveDebugEnabled) || !result.faceLandmarks[0]) return result

    const snapshot = eyeSignalSnapshot(result)

    if (this.diagnosticEnabled) {
      if (this.diagnosticStartedAt < 0) this.diagnosticStartedAt = timestampMs
      const elapsed = timestampMs - this.diagnosticStartedAt
      const frame = eyeRigDiagnosticFrame(elapsed)
      this.updateDiagnosticPanel(
        frame ? `RIG FORZADO · ${frame.label}` : 'RIG FORZADO TERMINADO · SEÑAL EN VIVO',
        snapshot,
        true,
      )

      return frame
        ? overrideEyeBlinkScores(result, frame.left, frame.right)
        : result
    }

    this.updateDiagnosticPanel('SEÑAL EN VIVO · SIN ALTERAR', snapshot, false)
    return result
  }

  close(): void {
    this.landmarker?.close()
    this.landmarker = null
    this.diagnosticPanel?.remove()
    this.diagnosticPanel = null
    this.diagnosticStartedAt = -1
  }

  private updateDiagnosticPanel(
    label: string,
    snapshot: ReturnType<typeof eyeSignalSnapshot>,
    forced: boolean,
  ): void {
    if (!this.diagnosticPanel) {
      const panel = document.createElement('div')
      panel.id = 'facecam-eye-rig-diagnostic'
      panel.style.position = 'fixed'
      panel.style.top = '12px'
      panel.style.left = '12px'
      panel.style.zIndex = '2147483647'
      panel.style.padding = '10px 12px'
      panel.style.border = '1px solid rgba(140,236,255,0.9)'
      panel.style.borderRadius = '8px'
      panel.style.background = 'rgba(4,10,18,0.92)'
      panel.style.color = '#e8fcff'
      panel.style.font = '600 13px/1.35 system-ui, sans-serif'
      panel.style.whiteSpace = 'pre'
      panel.style.pointerEvents = 'none'
      document.body.appendChild(panel)
      this.diagnosticPanel = panel
    }

    const openingLeft = snapshot.openingLeft === null ? '—' : snapshot.openingLeft.toFixed(3)
    const openingRight = snapshot.openingRight === null ? '—' : snapshot.openingRight.toFixed(3)
    const mouthHeight = snapshot.mouthHeight === null ? '—' : snapshot.mouthHeight.toFixed(4)
    const mouthGapToSpan = snapshot.mouthGapToSpan === null ? '—' : snapshot.mouthGapToSpan.toFixed(4)

    this.diagnosticPanel.textContent = [
      `FACE CAM DIAGNÓSTICO: ${label}`,
      forced ? 'ATENCIÓN: los blink enviados al rig están siendo forzados temporalmente.' : 'LECTURA: ningún valor está siendo modificado.',
      `MediaPipe blink L ${snapshot.rawLeft.toFixed(3)} · R ${snapshot.rawRight.toFixed(3)}`,
      `Apertura ojo L ${openingLeft} · R ${openingRight}`,
      `jawOpen ${snapshot.jawOpen.toFixed(3)} · mouthClose ${snapshot.mouthClose.toFixed(3)}`,
      `Boca geom. altura ${mouthHeight} · gap/span ${mouthGapToSpan}`,
      `Blendshapes recibidos: ${snapshot.blendshapeCount}`,
    ].join('\n')
  }
}
