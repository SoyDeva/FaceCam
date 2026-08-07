import { useEffect, useRef, useState } from 'react'
import { runtimeConfig } from '../../config/runtime'
import { StaticDragonRenderer } from './StaticDragonRenderer'
import {
  loadLocalDragonModel,
  removeLocalDragonModel,
  saveLocalDragonModel,
} from './localAssetStore'

const OFFICIAL_MODEL_NAME = 'FaceCam-Dragon-Blanco-Rigged-CORRECTO-v8.glb'
const OFFICIAL_MODEL_SHA256 = '9388ec811755a44e6c31809b820cc66f513648243dc89e58e4a0bbfb98335f11'
const MAX_GLB_SIZE = 15 * 1024 * 1024

type InstallerState = 'checking' | 'needed' | 'installing' | 'error' | 'hidden'

async function sha256(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Este navegador no permite verificar de forma segura el archivo del dragón.')
  }

  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function validateCorrectedRig(blob: Blob): Promise<void> {
  const renderer = new StaticDragonRenderer(
    runtimeConfig.outputWidth,
    runtimeConfig.outputHeight,
  )

  try {
    await renderer.load(blob)

    // The fingerprint guarantees the exact v8 GLB whose eyeBlink targets were
    // rebuilt around the two blue visible eyes. Base mesh, textures and jawOpen
    // are preserved from v7; only the two authored eyelid POSITION targets change.
    if (renderer.facialRigMode === 'static-model') {
      throw new Error(
        'El modelo guardado no activó el rig facial del Dragón Blanco v8.',
      )
    }
  } finally {
    renderer.dispose()
  }
}

async function validateOfficialRig(blob: Blob): Promise<void> {
  const fingerprint = await sha256(blob)
  if (fingerprint !== OFFICIAL_MODEL_SHA256) {
    throw new Error(
      'El archivo no corresponde al Dragón Blanco riggeado v8 de FaceCam.',
    )
  }

  await validateCorrectedRig(blob)
}

export function MainDragonInstaller() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<InstallerState>('checking')
  const [message, setMessage] = useState('Comprobando el dragón instalado…')

  useEffect(() => {
    let cancelled = false

    async function inspectStoredModel(): Promise<void> {
      try {
        const stored = await loadLocalDragonModel()
        if (cancelled) return

        if (!stored) {
          setState('needed')
          setMessage('Instala el dragón v8 con los párpados reconstruidos sobre los ojos azules.')
          return
        }

        setMessage('Verificando el GLB v8, sus dos párpados y la mandíbula conservada…')

        try {
          await validateOfficialRig(stored.blob)
        } catch (validationError) {
          await removeLocalDragonModel()
          if (cancelled) return

          // Replacing v7 with v8 changes only the authored eye targets. Preserve
          // head/expression calibration so the approved mouth response is untouched.
          setState('needed')
          setMessage(
            'FaceCam retiró el GLB anterior sin borrar tu calibración. Selecciona el archivo v8.',
          )

          window.setTimeout(() => window.location.reload(), 450)
          console.warn('FaceCam retiró un GLB anterior o incompatible.', validationError)
          return
        }

        if (!cancelled) setState('hidden')
      } catch (error) {
        if (cancelled) return
        setState('needed')
        setMessage('FaceCam necesita instalar el Dragón Blanco riggeado v8 en este navegador.')
        console.warn('No fue posible validar el dragón guardado.', error)
      }
    }

    void inspectStoredModel()

    return () => {
      cancelled = true
    }
  }, [])

  async function install(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.glb')) {
      throw new Error('Selecciona un archivo GLB válido.')
    }
    if (file.size <= 0 || file.size > MAX_GLB_SIZE) {
      throw new Error('El GLB debe pesar entre 1 byte y 15 MB.')
    }

    await validateOfficialRig(file)
    await saveLocalDragonModel(file, OFFICIAL_MODEL_NAME)
  }

  async function handleSelection(file: File | undefined): Promise<void> {
    if (!file) return

    setState('installing')
    setMessage('Verificando el GLB v8 sin modificar tu calibración de boca…')

    try {
      await install(file)
      setMessage('Dragón v8 instalado. Reiniciando FaceCam para validar el rig nativo…')
      window.setTimeout(() => window.location.reload(), 450)
    } catch (error) {
      setState('error')
      setMessage(
        error instanceof Error
          ? error.message
          : 'No fue posible instalar el GLB.',
      )
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  if (state === 'hidden') return null

  return (
    <aside
      aria-live="polite"
      style={{
        position: 'fixed',
        zIndex: 1000,
        right: 'max(1rem, env(safe-area-inset-right))',
        bottom: 'max(1rem, env(safe-area-inset-bottom))',
        width: 'min(24rem, calc(100vw - 2rem))',
        padding: '1rem',
        border: '1px solid rgba(132, 224, 255, 0.38)',
        borderRadius: '1rem',
        background: 'rgba(7, 12, 20, 0.96)',
        boxShadow: '0 1rem 3rem rgba(0, 0, 0, 0.48)',
        backdropFilter: 'blur(14px)',
      }}
    >
      <p className="eyebrow" style={{ margin: 0 }}>REPARACIÓN DEL DRAGÓN</p>
      <strong style={{ display: 'block', marginTop: '0.35rem' }}>
        Dragón Blanco riggeado v8
      </strong>
      <p style={{ margin: '0.55rem 0 0.8rem', lineHeight: 1.45 }}>{message}</p>

      <input
        accept=".glb,model/gltf-binary"
        hidden
        onChange={(event) => void handleSelection(event.target.files?.[0])}
        ref={inputRef}
        type="file"
      />

      <button
        className="primary-button"
        disabled={state === 'checking' || state === 'installing'}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        {state === 'installing'
          ? 'Instalando…'
          : state === 'error'
            ? 'Seleccionar otro archivo'
            : 'Seleccionar dragón v8'}
      </button>
    </aside>
  )
}
