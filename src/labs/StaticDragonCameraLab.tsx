import { useCallback, useEffect, useRef, useState } from 'react'
import { runtimeConfig } from '../config/runtime'
import {
  describeMediaError,
  openCamera,
  stopStream,
} from '../camera/devices'
import { FaceTracker } from '../tracking/faceTracker'
import {
  DEFAULT_STATIC_DRAGON_CALIBRATION,
  StaticDragonRenderer,
  type StaticDragonCalibration,
} from '../masks/three/StaticDragonRenderer'
import { estimateStaticDragonPose } from '../masks/three/staticPose'
import {
  loadLocalDragonCalibration,
  loadLocalDragonModel,
  saveLocalDragonCalibration,
  saveLocalDragonModel,
} from '../masks/three/localAssetStore'

interface OutputSize {
  width: number
  height: number
}

type LabStatus = 'idle' | 'requesting' | 'ready' | 'error'

function fitCameraOutput(videoWidth: number, videoHeight: number): OutputSize {
  const sourceWidth = Math.max(1, videoWidth)
  const sourceHeight = Math.max(1, videoHeight)
  const portrait = sourceHeight > sourceWidth
  const maxWidth = portrait ? runtimeConfig.outputHeight : runtimeConfig.outputWidth
  const maxHeight = portrait ? runtimeConfig.outputWidth : runtimeConfig.outputHeight
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight)
  const toEven = (value: number) => Math.max(2, Math.round(value / 2) * 2)

  return {
    width: toEven(sourceWidth * scale),
    height: toEven(sourceHeight * scale),
  }
}

export function StaticDragonCameraLab() {
  const initialCalibration = loadLocalDragonCalibration()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const trackerRef = useRef(new FaceTracker())
  const dragonRendererRef = useRef<StaticDragonRenderer | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastTrackingAtRef = useRef(0)
  const lastResultRef = useRef<ReturnType<FaceTracker['detect']>>(null)
  const calibrationRef = useRef<StaticDragonCalibration>(initialCalibration)
  const mirrorRef = useRef(true)
  const faceVisibleRef = useRef(false)
  const mountedRef = useRef(true)

  const [status, setStatus] = useState<LabStatus>('idle')
  const [message, setMessage] = useState('Buscando un Dragón Blanco instalado en este navegador…')
  const [modelName, setModelName] = useState('')
  const [modelReady, setModelReady] = useState(false)
  const [modelInstalled, setModelInstalled] = useState(false)
  const [faceVisible, setFaceVisible] = useState(false)
  const [mirror, setMirror] = useState(true)
  const [calibration, setCalibration] = useState<StaticDragonCalibration>(initialCalibration)
  const [outputSize, setOutputSize] = useState<OutputSize>({
    width: runtimeConfig.outputWidth,
    height: runtimeConfig.outputHeight,
  })

  function updateCalibration(patch: Partial<StaticDragonCalibration>) {
    setCalibration((current) => {
      const next = { ...current, ...patch }
      calibrationRef.current = next
      saveLocalDragonCalibration(next)
      return next
    })
  }

  async function prepareModel(blob: Blob, name: string, persist: boolean) {
    setMessage(persist ? 'Validando e instalando el GLB local…' : 'Cargando el Dragón Blanco instalado…')

    try {
      const canvas = canvasRef.current
      const renderer = dragonRendererRef.current ?? new StaticDragonRenderer(
        canvas?.width ?? outputSize.width,
        canvas?.height ?? outputSize.height,
      )
      dragonRendererRef.current = renderer
      renderer.setSize(outputSize.width, outputSize.height)
      await renderer.load(blob)

      let installed = !persist
      let storageWarning = ''
      if (persist) {
        try {
          await saveLocalDragonModel(blob, name)
          installed = true
        } catch (storageError) {
          console.warn('El GLB funciona, pero no pudo instalarse de forma persistente.', storageError)
          storageWarning = ' El modelo funciona ahora, pero el navegador no permitió conservarlo para la cámara principal.'
        }
      }

      if (!mountedRef.current) return
      setModelName(name)
      setModelReady(true)
      setModelInstalled(installed)
      setMessage(
        status === 'ready'
          ? `Dragón 3D ${installed ? 'instalado y ' : ''}activo. Ajusta la calibración y vuelve a FaceCam.${storageWarning}`
          : `Modelo ${installed ? 'instalado' : 'validado'}. Activa la cámara para comprobarlo.${storageWarning}`,
      )
    } catch (caught) {
      if (!mountedRef.current) return
      setModelReady(false)
      setMessage(caught instanceof Error ? caught.message : 'No fue posible cargar el GLB.')
    }
  }

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
    if (now - lastTrackingAtRef.current >= 40) {
      lastTrackingAtRef.current = now
      try {
        lastResultRef.current = trackerRef.current.detect(video, now)
      } catch (error) {
        console.warn('Fotograma de seguimiento omitido en el laboratorio 3D.', error)
      }
    }

    const pose = estimateStaticDragonPose(lastResultRef.current)
    const renderer = dragonRendererRef.current
    const rendered = renderer?.render(
      pose,
      calibrationRef.current,
      mirrorRef.current,
    ) ?? false

    if (rendered && renderer) {
      context.save()
      if (mirrorRef.current) {
        context.translate(canvas.width, 0)
        context.scale(-1, 1)
      }
      context.drawImage(renderer.canvas, 0, 0, canvas.width, canvas.height)
      context.restore()
    }

    if (rendered !== faceVisibleRef.current) {
      faceVisibleRef.current = rendered
      setFaceVisible(rendered)
    }

    animationFrameRef.current = requestAnimationFrame(renderLoop)
  }, [])

  const activateCamera = useCallback(async () => {
    setStatus('requesting')
    setMessage('Solicitando la cámara para la prueba 3D…')

    const existingVideo = videoRef.current
    if (existingVideo) existingVideo.onresize = null
    stopStream(streamRef.current)
    streamRef.current = null

    try {
      const stream = await openCamera()
      streamRef.current = stream

      const video = videoRef.current
      if (!video) throw new Error('No fue posible preparar la vista de calibración.')
      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      await video.play()

      const syncOutputSize = () => {
        if (!video.videoWidth || !video.videoHeight) return
        const next = fitCameraOutput(video.videoWidth, video.videoHeight)
        setOutputSize((current) =>
          current.width === next.width && current.height === next.height ? current : next,
        )
      }
      syncOutputSize()
      video.onresize = syncOutputSize

      setStatus('ready')
      setMessage(
        modelReady
          ? 'Cámara activa. Preparando seguimiento rígido del Dragón Blanco…'
          : 'Cámara activa. Instala el GLB para verlo y usarlo en FaceCam.',
      )

      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = requestAnimationFrame(renderLoop)

      await trackerRef.current.initialize()
      setMessage(
        modelReady
          ? 'Seguimiento rígido activo. La calibración se guarda automáticamente para FaceCam.'
          : 'Seguimiento activo. Elige el GLB para instalarlo en este navegador.',
      )
    } catch (caught) {
      stopStream(streamRef.current)
      streamRef.current = null
      setStatus('error')
      setMessage(describeMediaError(caught))
    }
  }, [modelReady, renderLoop])

  useEffect(() => {
    void loadLocalDragonModel()
      .then((stored) => {
        if (!stored || !mountedRef.current) {
          if (mountedRef.current) {
            setMessage('No hay un modelo 3D instalado. Selecciona el GLB una vez para usarlo también en FaceCam.')
          }
          return
        }
        void prepareModel(stored.blob, stored.name, false)
      })
      .catch((error) => {
        console.warn('No fue posible consultar el modelo 3D instalado.', error)
        if (mountedRef.current) {
          setMessage('Selecciona el GLB para instalarlo localmente en este navegador.')
        }
      })
  }, [])

  useEffect(() => {
    dragonRendererRef.current?.setSize(outputSize.width, outputSize.height)
  }, [outputSize])

  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      if (videoRef.current) videoRef.current.onresize = null
      stopStream(streamRef.current)
      trackerRef.current.close()
      dragonRendererRef.current?.dispose()
    }
  }, [])

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div>
          <p className="eyebrow">FACE CAM · LABORATORIO LOCAL</p>
          <h1>Calibración del Dragón 3D</h1>
        </div>
        <button
          className="ghost-button"
          onClick={() => window.location.assign(import.meta.env.BASE_URL)}
          type="button"
        >
          Volver a FaceCam
        </button>
      </header>

      <section className="stage-card">
        <div className="stage" style={{ aspectRatio: `${outputSize.width} / ${outputSize.height}` }}>
          <video aria-hidden="true" muted playsInline ref={videoRef} />
          <canvas
            aria-label="Laboratorio de cámara con modelo 3D local"
            height={outputSize.height}
            ref={canvasRef}
            width={outputSize.width}
          />
          <div className="stage-overlay">
            <span className={`status-dot ${faceVisible ? 'online' : ''}`} />
            {faceVisible ? 'Modelo siguiendo la cabeza' : 'Esperando modelo y rostro'}
          </div>
        </div>

        <div className="control-panel">
          <div className="control-grid">
            <label>
              Instalar o reemplazar GLB
              <input
                accept=".glb,model/gltf-binary"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void prepareModel(file, file.name, true)
                }}
                type="file"
              />
            </label>

            <label className="toggle-row">
              <span>Modo espejo</span>
              <input
                checked={mirror}
                onChange={(event) => {
                  setMirror(event.target.checked)
                  mirrorRef.current = event.target.checked
                }}
                type="checkbox"
              />
            </label>

            <label className="toggle-row">
              <span>Modelo orientado al revés</span>
              <input
                checked={calibration.facingReversed}
                onChange={(event) => updateCalibration({ facingReversed: event.target.checked })}
                type="checkbox"
              />
            </label>

            <label className="toggle-row">
              <span>Cobertura posterior</span>
              <input
                checked={calibration.coverageShield}
                onChange={(event) => updateCalibration({ coverageShield: event.target.checked })}
                type="checkbox"
              />
            </label>
          </div>

          <details open>
            <summary>Calibración de cobertura</summary>
            <div className="control-grid">
              <label>
                Escala · {calibration.scaleMultiplier.toFixed(2)}
                <input
                  max="2.4"
                  min="1"
                  onChange={(event) => updateCalibration({ scaleMultiplier: Number(event.target.value) })}
                  step="0.01"
                  type="range"
                  value={calibration.scaleMultiplier}
                />
              </label>
              <label>
                Horizontal · {calibration.offsetX.toFixed(2)}
                <input
                  max="0.5"
                  min="-0.5"
                  onChange={(event) => updateCalibration({ offsetX: Number(event.target.value) })}
                  step="0.01"
                  type="range"
                  value={calibration.offsetX}
                />
              </label>
              <label>
                Vertical · {calibration.offsetY.toFixed(2)}
                <input
                  max="0.5"
                  min="-0.5"
                  onChange={(event) => updateCalibration({ offsetY: Number(event.target.value) })}
                  step="0.01"
                  type="range"
                  value={calibration.offsetY}
                />
              </label>
              <label>
                Respuesta horizontal · {calibration.yawMultiplier.toFixed(2)}
                <input
                  max="1.5"
                  min="0"
                  onChange={(event) => updateCalibration({ yawMultiplier: Number(event.target.value) })}
                  step="0.01"
                  type="range"
                  value={calibration.yawMultiplier}
                />
              </label>
              <label>
                Respuesta vertical · {calibration.pitchMultiplier.toFixed(2)}
                <input
                  max="1.5"
                  min="0"
                  onChange={(event) => updateCalibration({ pitchMultiplier: Number(event.target.value) })}
                  step="0.01"
                  type="range"
                  value={calibration.pitchMultiplier}
                />
              </label>
            </div>
            <button
              className="ghost-button"
              onClick={() => {
                const defaults = { ...DEFAULT_STATIC_DRAGON_CALIBRATION }
                setCalibration(defaults)
                calibrationRef.current = defaults
                saveLocalDragonCalibration(defaults)
              }}
              type="button"
            >
              Restablecer calibración
            </button>
          </details>

          <p className={`studio-message ${status === 'error' ? 'error-message' : ''}`}>{message}</p>
          {modelName && (
            <p className="privacy-note">
              <strong>{modelInstalled ? 'Instalado para FaceCam' : 'Activo en esta pestaña'}:</strong> {modelName}
            </p>
          )}

          {status !== 'ready' && (
            <div className="action-row">
              <button
                className="primary-button"
                disabled={status === 'requesting'}
                onClick={() => void activateCamera()}
                type="button"
              >
                {status === 'requesting' ? 'Activando…' : 'Activar cámara de prueba'}
              </button>
            </div>
          )}
        </div>
      </section>

      <aside className="privacy-note">
        <strong>Instalación local:</strong> el GLB se conserva en IndexedDB dentro de este navegador. No se envía a Supabase ni a otro servidor. La cámara principal lo cargará automáticamente y usará la máscara procedural como respaldo.
      </aside>
    </main>
  )
}
