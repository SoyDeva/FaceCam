import { useEffect, useMemo, useRef, useState } from 'react'
import { Mesh, type BufferAttribute } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { StaticDragonRenderer, DEFAULT_STATIC_DRAGON_CALIBRATION } from '../masks/three/StaticDragonRenderer'
import { loadLocalDragonModel } from '../masks/three/localAssetStore'
import type { StaticDragonPoseEstimate } from '../masks/three/staticPose'

type RigStage = 'NEUTRAL' | 'MANDÍBULA 100%' | 'AMBOS OJOS 100%' | 'OJO IZQUIERDO 100%' | 'OJO DERECHO 100%'

interface MorphReport {
  mesh: string
  visible: boolean
  semantic: string
  target: string
  index: number
  movedVertices: number
  totalVertices: number
  maxDelta: number
  meanDelta: number
}

const WIDTH = 960
const HEIGHT = 720
const BUILD_SHA = import.meta.env.VITE_FACECAM_BUILD_SHA ?? 'dev'
const STAGES: Array<{ label: RigStage; duration: number; jawOpen: number; blinkLeft: number; blinkRight: number }> = [
  { label: 'NEUTRAL', duration: 1200, jawOpen: 0, blinkLeft: 0, blinkRight: 0 },
  { label: 'MANDÍBULA 100%', duration: 1500, jawOpen: 1, blinkLeft: 0, blinkRight: 0 },
  { label: 'NEUTRAL', duration: 900, jawOpen: 0, blinkLeft: 0, blinkRight: 0 },
  { label: 'AMBOS OJOS 100%', duration: 1500, jawOpen: 0, blinkLeft: 1, blinkRight: 1 },
  { label: 'NEUTRAL', duration: 900, jawOpen: 0, blinkLeft: 0, blinkRight: 0 },
  { label: 'OJO IZQUIERDO 100%', duration: 1500, jawOpen: 0, blinkLeft: 1, blinkRight: 0 },
  { label: 'NEUTRAL', duration: 900, jawOpen: 0, blinkLeft: 0, blinkRight: 0 },
  { label: 'OJO DERECHO 100%', duration: 1500, jawOpen: 0, blinkLeft: 0, blinkRight: 1 },
]

const CYCLE_MS = STAGES.reduce((sum, stage) => sum + stage.duration, 0)

function stageAt(elapsedMs: number) {
  let cursor = elapsedMs % CYCLE_MS
  for (const stage of STAGES) {
    if (cursor < stage.duration) return stage
    cursor -= stage.duration
  }
  return STAGES[0]
}

function syntheticPose(jawOpen: number, blinkLeft: number, blinkRight: number): StaticDragonPoseEstimate {
  return {
    visible: true,
    centerX: 0.5,
    centerY: 0.46,
    eyeCenterX: 0.5,
    eyeCenterY: 0.39,
    eyeDistance: 0.16,
    faceWidth: 0.3,
    faceHeight: 0.42,
    foreheadX: 0.5,
    foreheadY: 0.2,
    chinX: 0.5,
    chinY: 0.64,
    neckAnchorX: 0.5,
    neckAnchorY: 0.78,
    roll: 0,
    yaw: 0,
    pitch: 0,
    jawOpen,
    blinkLeft,
    blinkRight,
    gazeX: 0,
    gazeY: 0,
    smile: 0,
    browRaise: 0,
  }
}

function effectiveVisible(mesh: Mesh): boolean {
  let current: Mesh['parent'] = mesh
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

function deltaReport(mesh: Mesh, targetName: string, index: number, semantic: string): MorphReport | null {
  const geometry = mesh.geometry
  const base = geometry.getAttribute('position') as BufferAttribute | undefined
  const morph = geometry.morphAttributes.position?.[index] as BufferAttribute | undefined
  if (!base || !morph || base.count !== morph.count) return null

  let maxDelta = 0
  let sumDelta = 0
  let movedVertices = 0
  for (let vertex = 0; vertex < morph.count; vertex += 1) {
    const dx = geometry.morphTargetsRelative ? morph.getX(vertex) : morph.getX(vertex) - base.getX(vertex)
    const dy = geometry.morphTargetsRelative ? morph.getY(vertex) : morph.getY(vertex) - base.getY(vertex)
    const dz = geometry.morphTargetsRelative ? morph.getZ(vertex) : morph.getZ(vertex) - base.getZ(vertex)
    const delta = Math.hypot(dx, dy, dz)
    if (delta > 1e-6) movedVertices += 1
    maxDelta = Math.max(maxDelta, delta)
    sumDelta += delta
  }

  return {
    mesh: mesh.name || '(malla sin nombre)',
    visible: effectiveVisible(mesh),
    semantic,
    target: targetName,
    index,
    movedVertices,
    totalVertices: morph.count,
    maxDelta,
    meanDelta: sumDelta / Math.max(1, morph.count),
  }
}

async function inspectMorphs(blob: Blob): Promise<MorphReport[]> {
  const url = URL.createObjectURL(blob)
  try {
    const gltf = await new GLTFLoader().loadAsync(url)
    const reports: MorphReport[] = []
    gltf.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const dictionary = object.morphTargetDictionary
      if (!dictionary) return

      const wanted = [
        ['jawOpen', 'jawOpen'],
        ['eyeBlinkLeft', 'blinkLeft'],
        ['eyeBlinkRight', 'blinkRight'],
      ] as const
      for (const [target, semantic] of wanted) {
        const index = dictionary[target]
        if (index === undefined) continue
        const report = deltaReport(object, target, index, semantic)
        if (report) reports.push(report)
      }
    })
    return reports
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function RendererRigDiagnostic() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<RigStage>('NEUTRAL')
  const [reports, setReports] = useState<MorphReport[]>([])
  const [status, setStatus] = useState('Cargando el GLB guardado…')
  const [rigMode, setRigMode] = useState('—')

  const worstWarning = useMemo(() => {
    if (!reports.length) return 'Todavía no hay reporte de morphs.'
    const missingMotion = reports.filter((report) => report.movedVertices === 0 || report.maxDelta <= 1e-6)
    if (missingMotion.length) return `ALERTA: ${missingMotion.length} morph(s) tienen desplazamiento geométrico nulo.`
    const hidden = reports.filter((report) => !report.visible)
    if (hidden.length) return `ALERTA: ${hidden.length} morph(s) pertenecen a una malla no visible.`
    return 'Los tres morphs tienen desplazamiento geométrico no nulo en la malla visible.'
  }, [reports])

  useEffect(() => {
    let disposed = false
    let frame = 0
    let renderer: StaticDragonRenderer | null = null

    void loadLocalDragonModel().then(async (stored) => {
      if (!stored || disposed) {
        if (!disposed) setStatus('No hay un GLB instalado en este navegador.')
        return
      }

      const nextReports = await inspectMorphs(stored.blob)
      if (disposed) return
      setReports(nextReports)

      renderer = new StaticDragonRenderer(WIDTH, HEIGHT)
      await renderer.load(stored.blob)
      if (disposed) {
        renderer.dispose()
        return
      }

      setRigMode(renderer.facialRigMode)
      const canvas = renderer.canvas
      canvas.style.display = 'block'
      canvas.style.width = '100%'
      canvas.style.height = 'auto'
      canvas.style.background = '#05070b'
      mountRef.current?.replaceChildren(canvas)
      setStatus(`GLB cargado: ${stored.name}. Ciclo nativo del renderer activo.`)

      const startedAt = performance.now()
      let previousStage: RigStage | null = null
      const loop = (now: number) => {
        if (disposed || !renderer) return
        const current = stageAt(now - startedAt)
        if (current.label !== previousStage) {
          previousStage = current.label
          setStage(current.label)
        }
        renderer.render(
          syntheticPose(current.jawOpen, current.blinkLeft, current.blinkRight),
          DEFAULT_STATIC_DRAGON_CALIBRATION,
          false,
          null,
        )
        frame = requestAnimationFrame(loop)
      }
      frame = requestAnimationFrame(loop)
    }).catch((error) => {
      console.error('Falló el diagnóstico directo del renderer.', error)
      if (!disposed) setStatus(error instanceof Error ? error.message : 'Falló el diagnóstico del renderer.')
    })

    return () => {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      renderer?.dispose()
      mountRef.current?.replaceChildren()
    }
  }, [])

  return (
    <main style={{ minHeight: '100vh', background: '#05070b', color: '#e8fcff', padding: '1rem' }}>
      <section style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <p className="eyebrow">FACE CAM · DIAGNÓSTICO DEL RENDERER</p>
        <h1 style={{ marginBottom: '0.35rem' }}>Rig directo del GLB</h1>
        <p style={{ marginTop: 0 }}>{status}</p>
        <div style={{ padding: '0.8rem 1rem', border: '1px solid rgba(140,236,255,0.55)', borderRadius: '0.75rem', marginBottom: '1rem' }}>
          <strong>FASE ACTUAL: {stage}</strong><br />
          <span>Build: {BUILD_SHA}</span><br />
          <span>Modo detectado por StaticDragonRenderer: {rigMode}</span><br />
          <span>Ruta ocular: MORPHS NATIVOS DEL GLB · sin shader auxiliar · sin ganancia adicional</span><br />
          <span>{worstWarning}</span>
        </div>

        <div ref={mountRef} style={{ overflow: 'hidden', borderRadius: '0.8rem', border: '1px solid rgba(140,236,255,0.3)' }} />

        <h2 style={{ marginTop: '1.25rem' }}>Morphs encontrados en el GLB guardado</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                {['Malla', 'Visible', 'Target', 'Índice', 'Vértices movidos', 'Máx. delta', 'Delta medio'].map((label) => (
                  <th key={label} style={{ textAlign: 'left', padding: '0.55rem', borderBottom: '1px solid rgba(140,236,255,0.3)' }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={`${report.mesh}-${report.target}-${report.index}`}>
                  <td style={{ padding: '0.5rem' }}>{report.mesh}</td>
                  <td style={{ padding: '0.5rem' }}>{report.visible ? 'sí' : 'NO'}</td>
                  <td style={{ padding: '0.5rem' }}>{report.target}</td>
                  <td style={{ padding: '0.5rem' }}>{report.index}</td>
                  <td style={{ padding: '0.5rem' }}>{report.movedVertices}/{report.totalVertices}</td>
                  <td style={{ padding: '0.5rem' }}>{report.maxDelta.toExponential(4)}</td>
                  <td style={{ padding: '0.5rem' }}>{report.meanDelta.toExponential(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
