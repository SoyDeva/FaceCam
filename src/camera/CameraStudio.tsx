import { useCallback, useEffect, useRef, useState } from 'react'
import type { UserSettings } from '../auth/types'
import { runtimeConfig } from '../config/runtime'
import { supabase } from '../config/supabase'
import { drawWhiteDragon } from '../masks/dragonPlaceholder'
import {
  StaticDragonRenderer,
  type StaticDragonCalibration,
} from '../masks/three/StaticDragonRenderer'
import {
  StaticDragonHeadCalibrator,
  type StaticDragonHeadCalibration,
} from '../masks/three/headCalibration'
import {
  loadLocalDragonCalibration,
  loadLocalDragonHeadCalibration,
  loadLocalDragonModel,
  saveLocalDragonHeadCalibration,
} from '../masks/three/localAssetStore'
import {
  estimateStaticDragonPose,
  smoothStaticDragonPose,
  type StaticDragonPoseEstimate,
} from '../masks/three/staticPose'
import { LocalRecorder } from '../recording/localRecorder'
import { formatDuration } from '../shared/format'
import { FaceTracker } from '../tracking/faceTracker'
import {
  describeMediaError,
  listCameras,
  openCamera,
  stopStream,
  type CameraDevice,
} from './devices'

interface CameraStudioProps {
  userId: string
}

type StudioStatus = 'idle' | 'requesting' | 'ready' | 'recording' | 'finalizing' | 'error'

interface OutputSize {
  width: number
  height: number
}

function fitCameraOutput(videoWidth: number, videoHeight: number): OutputSize {
  const sourceWidth = Math.max(1, videoWidth)
  const sourceHeight = Math.max(1, videoHeight)
  const isPortrait = sourceHeight > sourceWidth
  const maxWidth = isPortrait ? runtimeConfig.outputHeight : runtimeConfig.outputWidth
  const maxHeight = isPortrait ? runtimeConfig.outputWidth : runtimeConfig.outputHeight
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight)
  const toEven = (value: number) => Math.max(2, Math.round(value / 2) * 2)

  return {
    width: toEven(sourceWidth * scale),
    height: toEven(sourceHeight * scale),
  }
}

export function CameraStudio({ userId }: CameraStudioProps) {
  const initialHeadCalibration = loadLocalDragonHeadCalibration()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const trackerRef = useRef(new FaceTracker())
  const trackerReadyRef = useRef(false)
  const recorderRef = useRef(new LocalRecorder())
  const dragonRendererRef = useRef<StaticDragonRenderer | null>(null)
  const dragonReadyRef = useRef(false)
  const dragonCalibrationRef = useRef<StaticDragonCalibration>(loadLocalDragonCalibration())
  const headCalibrationRef = useRef<StaticDragonHeadCalibration | null>(initialHeadCalibration)
  const headCalibratorRef = useRef(new StaticDragonHeadCalibrator())
  const smoothedPoseRef = useRef<StaticDragonPoseEstimate | null>(null)
  const useThreeDragonRef = useRef(true)
  const recordingStartedAtRef = useRef(0)
  const stopRecordingRef = useRef<() => Promise<void>>(async () => undefined)
  const lastTrackingAtRef = useRef(0)
  const lastResultRef = useRef<ReturnType<FaceTracker['detect']>>(null)
  const mirrorRef = useRef(false)
  const neckEnabledRef = useRef(false)
  const faceVisibleRef = useRef(false)

  const [cameras, setCameras] = useState<CameraDevice[]>([])
  const [selectedCamera, setSelectedCamera] = useState('')
  const [mirror, setMirror] = useState(false)
  const [neckEnabled, setNeckEnabled] = useState(false)
  const [dragonInstalled, setDragonInstalled] = useState(false)
  const [useThreeDragon, setUseThreeDragon] = useState(true)
  const [calibratingHead, setCalibratingHead] = useState(false)
  const [headCalibrationProgress, setHeadCalibrationProgress] = useState(0)
  const [headCalibrated, setHeadCalibrated] = useState(Boolean(initialHeadCalibration))
  const [status, setStatus] = useState<StudioStatus>('idle')
  const [message, setMessage] = useState('Activa la cámara para comenzar.')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [faceVisible, setFaceVisible] = useState(false)
  const [outputSize, setOutputSize] = useState<OutputSize>({
    width: runtimeConfig.outputWidth,
    height: runtimeConfig.outputHeight,
  })

  const saveSettings = useCallback(async (patch: Partial<UserSettings>) => {
    const { error } = await supabase
      .from('user_settings')
      .update(patch)
      .eq('user_id', userId)
    if (error) console.warn('No fue posible guardar la preferencia.', error)
  }, [userId])

  const startHeadCalibration = useCallback(() => {
    if (!dragonReadyRef.current || !trackerReadyRef.current || !streamRef.current) {
      setMessage('Activa la cámara y espera a que el dragón 3D termine de cargar.')
      return
    }

    headCalibratorRef.current.start()
    headCalibrationRef.current = null
    smoothedPoseRef.current = null
    setCalibratingHead(true)
    setHeadCalibrated(false)
    setHeadCalibrationProgress(0)
    setMessage('Calibrando cabeza: mira al frente, mantente quieto y conserva una expresión neutral.')
  }, [])

  useEffect(() => {
    async function loadSettings() {
      const { data } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()
      if (data) {
        const settings = data as UserSettings
        setMirror(settings.mirror_enabled)
        mirrorRef.current = settings.mirror_enabled
        setNeckEnabled(settings.neck_enabled)
        neckEnabledRef.current = settings.neck_enabled
      }
    }
    void loadSettings()
  }, [userId])

  useEffect(() => {
    let cancelled = false

    void loadLocalDragonModel()
      .then(async (stored) => {
        if (!stored || cancelled) return

        const renderer = new StaticDragonRenderer(
          runtimeConfig.outputWidth,
          runtimeConfig.outputHeight,
        )
        try {
          await renderer.load(stored.blob)
          if (cancelled) {
            renderer.dispose()
            return
          }
          dragonRendererRef.current?.dispose()
          dragonRendererRef.current = renderer
          dragonReadyRef.current = true
          dragonCalibrationRef.current = loadLocalDragonCalibration()
          headCalibrationRef.current = loadLocalDragonHeadCalibration()
          setHeadCalibrated(Boolean(headCalibrationRef.current))
          setDragonInstalled(true)

          if (trackerReadyRef.current && streamRef.current && useThreeDragonRef.current) {
            startHeadCalibration()
          }
        } catch (error) {
          renderer.dispose()
          console.warn('El modelo 3D local no pudo cargarse; se usará la máscara de respaldo.', error)
        }
      })
      .catch((error) => {
        console.warn('No fue posible consultar el modelo 3D local.', error)
      })

    return () => {
      cancelled = true
    }
  }, [startHeadCalibration])

  useEffect(() => {
    dragonRendererRef.current?.setSize(outputSize.width, outputSize.height)
  }, [outputSize])

  const renderLoop = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const stream = streamRef.current
    if (!video || !canvas || !stream) return

    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return

    context.save()
    context.fillStyle = '#05070b'
    context.fillRect(0, 0, canvas.width, canvas.height)
    if (mirrorRef.current) {
      context.translate(canvas.width, 0)
      context.scale(-1, 1)
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    context.restore()

    const now = performance.now()
    let freshTrackingFrame = false
    if (now - lastTrackingAtRef.current >= 40) {
      lastTrackingAtRef.current = now
      try {
        lastResultRef.current = trackerRef.current.detect(video, now)
        freshTrackingFrame = true
      } catch (error) {
        console.warn('Fotograma de seguimiento omitido.', error)
      }
    }

    const rawPose = estimateStaticDragonPose(lastResultRef.current)
    if (freshTrackingFrame && headCalibratorRef.current.active) {
      const capture = headCalibratorRef.current.capture(rawPose)
      if (capture.accepted) setHeadCalibrationProgress(capture.progress)
      if (capture.calibration) {
        headCalibrationRef.current = capture.calibration
        saveLocalDragonHeadCalibration(capture.calibration)
        setCalibratingHead(false)
        setHeadCalibrated(true)
        setMessage('Cabeza calibrada. Los ojos quedaron anclados y la escala permanecerá fija al girar.')
      }
    }

    const pose = smoothStaticDragonPose(smoothedPoseRef.current, rawPose)
    smoothedPoseRef.current = pose.visible ? pose : null

    let detected = false
    const dragonRenderer = dragonRendererRef.current
    if (useThreeDragonRef.current && dragonReadyRef.current && dragonRenderer) {
      const rendered = dragonRenderer.render(
        pose,
        dragonCalibrationRef.current,
        mirrorRef.current,
        headCalibrationRef.current,
      )

      if (rendered) {
        context.save()
        if (mirrorRef.current) {
          context.translate(canvas.width, 0)
          context.scale(-1, 1)
        }
        context.drawImage(dragonRenderer.canvas, 0, 0, canvas.width, canvas.height)
        context.restore()
        detected = true
      }
    }

    if (!detected) {
      context.save()
      if (mirrorRef.current) {
        context.translate(canvas.width, 0)
        context.scale(-1, 1)
      }
      detected = drawWhiteDragon(
        context,
        lastResultRef.current,
        canvas.width,
        canvas.height,
        neckEnabledRef.current,
      )
      context.restore()
    }

    if (detected !== faceVisibleRef.current) {
      faceVisibleRef.current = detected
      setFaceVisible(detected)
    }

    animationFrameRef.current = requestAnimationFrame(renderLoop)
  }, [])

  const activateCamera = useCallback(async (deviceId?: string) => {
    setStatus('requesting')
    setMessage('Solicitando permiso para usar la cámara…')
    trackerReadyRef.current = false
    headCalibratorRef.current.cancel()
    setCalibratingHead(false)

    const currentVideo = videoRef.current
    if (currentVideo) currentVideo.onresize = null
    stopStream(streamRef.current)
    streamRef.current = null

    try {
      const stream = await openCamera(deviceId)
      streamRef.current = stream

      const video = videoRef.current
      if (!video) throw new Error('No se pudo preparar la vista previa.')

      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      await video.play()

      const syncOutputSize = () => {
        if (!video.videoWidth || !video.videoHeight) return
        const nextSize = fitCameraOutput(video.videoWidth, video.videoHeight)
        setOutputSize((currentSize) =>
          currentSize.width === nextSize.width && currentSize.height === nextSize.height
            ? currentSize
            : nextSize,
        )
      }

      syncOutputSize()
      video.onresize = syncOutputSize

      try {
        const availableCameras = await listCameras()
        setCameras(availableCameras)
      } catch (deviceError) {
        console.warn('No fue posible enumerar las cámaras.', deviceError)
      }

      const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? ''
      setSelectedCamera(activeDeviceId)
      setStatus('ready')

      const hasAudio = stream.getAudioTracks().length > 0
      setMessage(
        hasAudio
          ? 'Cámara y micrófono activos. Preparando el análisis inicial de la cabeza…'
          : 'Cámara activa sin micrófono. Preparando el análisis inicial de la cabeza…',
      )

      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = requestAnimationFrame(renderLoop)

      void trackerRef.current.initialize()
        .then(() => {
          trackerReadyRef.current = true
          if (dragonReadyRef.current && useThreeDragonRef.current) {
            startHeadCalibration()
          } else {
            setMessage(
              hasAudio
                ? 'Procesamiento local activo. La cámara conserva su proporción original.'
                : 'Cámara y máscara activas. El video se grabará sin audio.',
            )
          }
        })
        .catch((trackingError) => {
          console.error('No fue posible iniciar el seguimiento facial.', trackingError)
          setMessage('La cámara está activa, pero el seguimiento facial no pudo iniciarse en este dispositivo.')
        })
    } catch (caught) {
      stopStream(streamRef.current)
      streamRef.current = null
      setStatus('error')
      setMessage(describeMediaError(caught))
    }
  }, [renderLoop, startHeadCalibration])

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      if (videoRef.current) videoRef.current.onresize = null
      stopStream(streamRef.current)
      trackerRef.current.close()
      dragonRendererRef.current?.dispose()
      dragonRendererRef.current = null
      dragonReadyRef.current = false
      trackerReadyRef.current = false
    }
  }, [])

  useEffect(() => {
    if (status !== 'recording') return
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - recordingStartedAtRef.current
      setElapsedMs(elapsed)
      if (elapsed >= runtimeConfig.maxRecordingMs) void stopRecordingRef.current()
    }, 250)
    return () => window.clearInterval(timer)
  }, [status])

  async function startRecording() {
    const canvas = canvasRef.current
    const sourceStream = streamRef.current
    if (!canvas || !sourceStream) return
    if (dragonInstalled && useThreeDragonRef.current && !headCalibrationRef.current) {
      setMessage('Termina la calibración frontal antes de comenzar a grabar con el dragón 3D.')
      return
    }

    const canvasStream = canvas.captureStream(30)
    sourceStream.getAudioTracks().forEach((track) => canvasStream.addTrack(track))

    try {
      await recorderRef.current.start(canvasStream)
      recordingStartedAtRef.current = Date.now()
      setElapsedMs(0)
      setStatus('recording')
      setMessage('Grabando localmente. La escala calibrada del dragón permanecerá bloqueada.')
    } catch (caught) {
      setStatus('error')
      setMessage(caught instanceof Error ? caught.message : 'No fue posible comenzar la grabación.')
    }
  }

  async function stopRecording() {
    if (status !== 'recording') return

    setStatus('finalizing')
    setMessage('Preparando el archivo local…')

    try {
      const file = await recorderRef.current.stop()
      const url = URL.createObjectURL(file)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = file.name
      anchor.style.display = 'none'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30 * 60 * 1_000)
      setStatus('ready')
      setElapsedMs(0)
      setMessage('Grabación terminada y enviada a descargas.')
    } catch (caught) {
      setStatus('error')
      setMessage(caught instanceof Error ? caught.message : 'No fue posible finalizar la grabación.')
    }
  }

  stopRecordingRef.current = stopRecording

  async function changeCamera(deviceId: string) {
    setSelectedCamera(deviceId)
    if (status === 'recording' || status === 'finalizing') return
    await activateCamera(deviceId)
  }

  const cameraActive = ['ready', 'recording', 'finalizing'].includes(status)
  const threeDragonActive = dragonInstalled && useThreeDragon
  const calibrationPercent = Math.round(headCalibrationProgress * 100)

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div>
          <p className="eyebrow">FACE CAM · PROTOTIPO 0.3</p>
          <h1>Dragón Blanco</h1>
        </div>
        <button className="ghost-button" onClick={() => void supabase.auth.signOut()} type="button">
          Cerrar sesión
        </button>
      </header>

      <section className="stage-card">
        <div
          className="stage"
          style={{ aspectRatio: `${outputSize.width} / ${outputSize.height}` }}
        >
          <video aria-hidden="true" muted playsInline ref={videoRef} />
          <canvas
            aria-label="Vista previa de cámara con máscara"
            height={outputSize.height}
            ref={canvasRef}
            width={outputSize.width}
          />
          <div className="stage-overlay">
            <span className={`status-dot ${faceVisible ? 'online' : ''}`} />
            {calibratingHead
              ? `Calibrando cabeza · ${calibrationPercent}%`
              : faceVisible
                ? 'Rostro detectado'
                : 'Buscando rostro'}
          </div>
          {status === 'recording' && (
            <div className="recording-badge"><span /> REC {formatDuration(elapsedMs)} / 30:00</div>
          )}
        </div>

        <div className="control-panel">
          <div className="control-grid">
            <label>
              Cámara
              <select
                disabled={status === 'recording' || status === 'finalizing'}
                onChange={(event) => void changeCamera(event.target.value)}
                value={selectedCamera}
              >
                {!cameras.length && <option value="">Automática</option>}
                {cameras.map((camera) => (
                  <option key={camera.deviceId} value={camera.deviceId}>{camera.label}</option>
                ))}
              </select>
            </label>

            <label className="toggle-row">
              <span>Modo espejo</span>
              <input
                checked={mirror}
                onChange={(event) => {
                  setMirror(event.target.checked)
                  mirrorRef.current = event.target.checked
                  void saveSettings({ mirror_enabled: event.target.checked })
                }}
                type="checkbox"
              />
            </label>

            <label className="toggle-row">
              <span>Usar dragón 3D local</span>
              <input
                checked={threeDragonActive}
                disabled={!dragonInstalled}
                onChange={(event) => {
                  setUseThreeDragon(event.target.checked)
                  useThreeDragonRef.current = event.target.checked
                  if (event.target.checked && trackerReadyRef.current && streamRef.current) {
                    startHeadCalibration()
                  }
                }}
                type="checkbox"
              />
            </label>

            <label className="toggle-row">
              <span>{threeDragonActive ? 'Cuello incluido en el GLB' : 'Cuello del dragón'}</span>
              <input
                checked={threeDragonActive ? true : neckEnabled}
                disabled={threeDragonActive}
                onChange={(event) => {
                  setNeckEnabled(event.target.checked)
                  neckEnabledRef.current = event.target.checked
                  void saveSettings({ neck_enabled: event.target.checked })
                }}
                type="checkbox"
              />
            </label>
          </div>

          <p className={`studio-message ${status === 'error' ? 'error-message' : ''}`}>{message}</p>
          <p className="privacy-note">
            <strong>Máscara activa:</strong>{' '}
            {threeDragonActive
              ? headCalibrated
                ? 'Dragón 3D con ojos anclados y escala fija; se incluirá en la grabación.'
                : 'Dragón 3D pendiente de calibración frontal.'
              : dragonInstalled
                ? 'Máscara procedural de respaldo. Puedes volver a activar el modelo 3D.'
                : 'Máscara procedural de respaldo. Instala el GLB desde el laboratorio 3D.'}
          </p>

          <div className="action-row">
            <button
              className="ghost-button"
              disabled={status === 'recording' || status === 'finalizing'}
              onClick={() => window.location.assign(`${import.meta.env.BASE_URL}?dragonLab=1`)}
              type="button"
            >
              {dragonInstalled ? 'Ajustar dragón 3D' : 'Instalar dragón 3D'}
            </button>

            {dragonInstalled && cameraActive && status !== 'recording' && status !== 'finalizing' && (
              <button
                className="ghost-button"
                disabled={calibratingHead}
                onClick={startHeadCalibration}
                type="button"
              >
                {calibratingHead ? `Calibrando ${calibrationPercent}%` : 'Calibrar cabeza'}
              </button>
            )}

            {!cameraActive && (
              <button
                className="primary-button"
                disabled={status === 'requesting'}
                onClick={() => void activateCamera()}
                type="button"
              >
                {status === 'requesting' ? 'Activando…' : 'Activar cámara'}
              </button>
            )}
            {status === 'ready' && (
              <button
                className="record-button"
                disabled={threeDragonActive && !headCalibrated}
                onClick={() => void startRecording()}
                type="button"
              >
                <span /> Grabar
              </button>
            )}
            {status === 'recording' && (
              <button className="stop-button" onClick={() => void stopRecording()} type="button">
                Detener y guardar
              </button>
            )}
          </div>
        </div>
      </section>

      <aside className="privacy-note">
        <strong>Privacidad local:</strong> los fotogramas, el audio, la forma calibrada de la cabeza, los datos faciales y el GLB permanecen en este dispositivo. Supabase solo conserva tu cuenta y preferencias.
      </aside>
    </main>
  )
}
