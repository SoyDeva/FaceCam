import { useEffect, useRef, useState } from 'react'
import { runtimeConfig } from '../../config/runtime'
import { StaticDragonRenderer } from './StaticDragonRenderer'
import {
  loadLocalDragonModel,
  removeLocalDragonHeadCalibration,
  saveLocalDragonModel,
} from './localAssetStore'

const RIGGED_NAME_PATTERN = /white-dragon-rigged-v1/i
const MAX_GLB_SIZE = 15 * 1024 * 1024

type InstallerState = 'checking' | 'needed' | 'installing' | 'error' | 'hidden'

export function MainDragonInstaller() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<InstallerState>('checking')
  const [message, setMessage] = useState('Comprobando el dragón instalado…')

  useEffect(() => {
    let cancelled = false

    void loadLocalDragonModel()
      .then((stored) => {
        if (cancelled) return
        if (stored && RIGGED_NAME_PATTERN.test(stored.name)) {
          setState('hidden')
          return
        }
        setState('needed')
        setMessage(
          stored
            ? 'Hay una versión anterior del dragón. Instala el rig nativo para mover su mandíbula y párpados reales.'
            : 'Instala el dragón riggeado directamente en FaceCam principal.',
        )
      })
      .catch(() => {
        if (cancelled) return
        setState('needed')
        setMessage('FaceCam necesita instalar el dragón riggeado en este navegador.')
      })

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

    const renderer = new StaticDragonRenderer(
      runtimeConfig.outputWidth,
      runtimeConfig.outputHeight,
    )

    try {
      await renderer.load(file)
      if (renderer.facialRigMode === 'static-model') {
        throw new Error(
          'Este archivo no contiene los morph targets jawOpen, eyeBlinkLeft y eyeBlinkRight.',
        )
      }

      await saveLocalDragonModel(file, file.name)
      removeLocalDragonHeadCalibration()
    } finally {
      renderer.dispose()
    }
  }

  async function handleSelection(file: File | undefined): Promise<void> {
    if (!file) return

    setState('installing')
    setMessage('Validando mandíbula, párpados, materiales y geometría del GLB…')

    try {
      await install(file)
      setMessage('Dragón riggeado instalado. Reiniciando FaceCam principal…')
      window.setTimeout(() => window.location.reload(), 450)
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : 'No fue posible instalar el GLB.')
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
      <p className="eyebrow" style={{ margin: 0 }}>ACTUALIZACIÓN DEL DRAGÓN</p>
      <strong style={{ display: 'block', marginTop: '0.35rem' }}>
        Rig facial nativo v1
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
        {state === 'installing' ? 'Instalando…' : state === 'error' ? 'Volver a seleccionar' : 'Instalar dragón riggeado'}
      </button>
    </aside>
  )
}
