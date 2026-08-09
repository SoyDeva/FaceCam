import { useEffect, useRef, useState } from 'react'
import { runtimeConfig } from '../../config/runtime'
import { StaticDragonRenderer } from './StaticDragonRenderer'
import {
  loadLocalDragonModel,
  removeLocalDragonModel,
  saveLocalDragonModel,
} from './localAssetStore'

const OFFICIAL_MODEL_NAME = 'FaceCam-Dragon-Blanco-HYBRID-v28.glb'
const OFFICIAL_MODEL_SHA256 = '8a5bf57dec3b17f0ae664ed7c37ae399c008820a72643efc6a5d03b655563692'
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

    // v28 keeps one complete Abierto_Dragon topology. Only its neutral-close
    // target was cleaned up: the lower central seal is restored and oral
    // internals are tucked behind the closed lips. Both eyelid morphs remain native.
    if (renderer.facialRigMode !== 'native') {
      throw new Error(
        'El modelo guardado no activó la malla única v28 con sello neutro corregido y ambos párpados.',
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
      'El archivo no corresponde al Dragón Blanco v28 de una sola malla con cierre neutro corregido.',
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
          setMessage('Instala el dragón v28: una sola malla Abierto_Dragon con cierre neutro limpio y párpados nativos.')
          return
        }

        setMessage('Verificando el GLB v28, el sello neutro corregido y ambos párpados…')

        try {
          await validateOfficialRig(stored.blob)
        } catch (validationError) {
          await removeLocalDragonModel()
          if (cancelled) return

          setState('needed')
          setMessage(
            'FaceCam retiró el GLB anterior sin borrar tu calibración. Selecciona el archivo v28.',
          )

          window.setTimeout(() => window.location.reload(), 450)
          console.warn('FaceCam retiró un GLB anterior o incompatible.', validationError)
          return
        }

        if (!cancelled) setState('hidden')
      } catch (error) {
        if (cancelled) return
        setState('needed')
        setMessage('FaceCam necesita instalar el Dragón Blanco v28 en este navegador.')
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
    setMessage('Verificando el GLB v28 sin modificar tu calibración ni la lógica de ojos…')

    try {
      await install(file)
      setMessage('Dragón v28 instalado. Reiniciando FaceCam con el cierre neutro corregido…')
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
        Dragón Blanco v28 · una sola malla + neutral corregido
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
            : 'Seleccionar dragón v28'}
      </button>
    </aside>
  )
}
