import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modelRoot = path.join(root, 'public', 'models', 'white-dragon')
const manifestPath = path.join(modelRoot, 'manifest.json')
const approvalPath = path.join(modelRoot, 'approval.json')

const errors = []
const warnings = []

function assert(condition, message) {
  if (!condition) errors.push(message)
}

function warn(condition, message) {
  if (!condition) warnings.push(message)
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    errors.push(`No fue posible leer ${path.relative(root, filePath)}: ${error.message}`)
    return null
  }
}

function validateManifest(manifest) {
  if (!manifest) return

  assert(manifest.schemaVersion === 1, 'manifest.schemaVersion debe ser 1.')
  assert(manifest.id === 'white-dragon', 'manifest.id debe ser white-dragon.')
  assert(typeof manifest.displayName === 'string' && manifest.displayName.length > 0, 'Falta displayName.')
  assert(typeof manifest.enabled === 'boolean', 'manifest.enabled debe ser booleano.')
  assert(typeof manifest.assetVersion === 'string', 'Falta assetVersion.')
  assert(manifest.contract === 'docs/white-dragon-3d-production-spec.md', 'El contrato del manifiesto no coincide.')
  assert(manifest.basisTranscoderPath === 'vendor/basis/', 'basisTranscoderPath debe ser vendor/basis/.')

  const expectedLods = {
    high: {
      url: 'models/white-dragon/white-dragon-high.glb',
      maxTextureSize: 4096,
      minTriangles: 60000,
      maxTriangles: 90000,
    },
    medium: {
      url: 'models/white-dragon/white-dragon-medium.glb',
      maxTextureSize: 2048,
      minTriangles: 25000,
      maxTriangles: 40000,
    },
    low: {
      url: 'models/white-dragon/white-dragon-low.glb',
      maxTextureSize: 1024,
      minTriangles: 12000,
      maxTriangles: 18000,
    },
  }

  for (const [name, expected] of Object.entries(expectedLods)) {
    const lod = manifest.lods?.[name]
    assert(Boolean(lod), `Falta el LOD ${name}.`)
    if (!lod) continue
    assert(lod.url === expected.url, `La URL del LOD ${name} no es canónica.`)
    assert(lod.maxTextureSize === expected.maxTextureSize, `maxTextureSize incorrecto en ${name}.`)
    assert(
      Number.isInteger(lod.targetTriangles) &&
        lod.targetTriangles >= expected.minTriangles &&
        lod.targetTriangles <= expected.maxTriangles,
      `targetTriangles de ${name} debe estar entre ${expected.minTriangles} y ${expected.maxTriangles}.`,
    )
  }

  const expectedNodes = {
    root: 'WhiteDragon_Root',
    headRig: 'Head_Rig',
    jaw: 'Jaw',
    leftEye: 'Eye_L',
    rightEye: 'Eye_R',
    headMesh: 'Dragon_Head_Mesh',
    eyesMesh: 'Dragon_Eyes_Mesh',
    sigil: 'Forehead_Sigil',
    neck: 'Dragon_Neck',
  }

  for (const [key, expected] of Object.entries(expectedNodes)) {
    assert(manifest.nodes?.[key] === expected, `Nodo canónico incorrecto: ${key}.`)
  }

  const nodeNames = Object.values(manifest.nodes ?? {})
  assert(new Set(nodeNames).size === nodeNames.length, 'Los nombres de nodo deben ser únicos.')
}

function validateApproval(manifest, approval) {
  if (!manifest || !approval) return

  assert(approval.schemaVersion === 1, 'approval.schemaVersion debe ser 1.')
  assert(typeof approval.assetVersion === 'string', 'approval.assetVersion es obligatorio.')

  const requiredGates = [
    'artDirection',
    'topologyAndLods',
    'pbrMaterials',
    'rigAndMorphTargets',
    'technicalIntegration',
    'mobilePerformance',
    'recordingStability',
    'finalVisualQuality',
  ]

  for (const gateName of requiredGates) {
    const gate = approval.gates?.[gateName]
    assert(Boolean(gate), `Falta el gate ${gateName}.`)
    if (!gate) continue
    assert(typeof gate.approved === 'boolean', `${gateName}.approved debe ser booleano.`)
    assert(Array.isArray(gate.evidence), `${gateName}.evidence debe ser una lista.`)

    if (manifest.enabled) {
      assert(gate.approved === true, `No se puede activar: ${gateName} no está aprobado.`)
      assert(gate.evidence.length > 0, `No se puede activar: ${gateName} no tiene evidencia.`)
      assert(
        gate.evidence.every((entry) => typeof entry === 'string' && entry.trim().length > 0),
        `${gateName} contiene evidencia vacía o inválida.`,
      )
    }
  }

  if (manifest.enabled) {
    assert(!manifest.assetVersion.includes('placeholder'), 'Un activo habilitado no puede usar versión placeholder.')
    assert(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.assetVersion), 'assetVersion debe ser semver.')
    assert(approval.assetVersion === manifest.assetVersion, 'La versión de approval.json no coincide con el manifiesto.')
  } else {
    warn(
      manifest.assetVersion.includes('placeholder'),
      'El manifiesto está desactivado pero assetVersion no indica placeholder.',
    )
  }
}

async function validateGlb(filePath, maxBytes, label) {
  let fileStat
  try {
    fileStat = await stat(filePath)
  } catch {
    errors.push(`Falta ${label}: ${path.relative(root, filePath)}.`)
    return
  }

  assert(fileStat.isFile(), `${label} no es un archivo regular.`)
  assert(fileStat.size <= maxBytes, `${label} supera el presupuesto de ${(maxBytes / 1024 / 1024).toFixed(0)} MiB.`)
  assert(fileStat.size >= 20, `${label} es demasiado pequeño para ser un GLB válido.`)
  if (fileStat.size < 20) return

  const handle = await readFile(filePath)
  const magic = handle.toString('ascii', 0, 4)
  const version = handle.readUInt32LE(4)
  const declaredLength = handle.readUInt32LE(8)

  assert(magic === 'glTF', `${label} no contiene la cabecera GLB glTF.`)
  assert(version === 2, `${label} debe usar GLB/glTF 2.0.`)
  assert(declaredLength === fileStat.size, `${label} declara una longitud distinta a su tamaño real.`)
}

async function main() {
  const manifest = await readJson(manifestPath)
  const approval = await readJson(approvalPath)

  validateManifest(manifest)
  validateApproval(manifest, approval)

  if (manifest?.enabled) {
    await validateGlb(path.join(modelRoot, 'white-dragon-high.glb'), 30 * 1024 * 1024, 'LOD High')
    await validateGlb(path.join(modelRoot, 'white-dragon-medium.glb'), 12 * 1024 * 1024, 'LOD Medium')
    await validateGlb(path.join(modelRoot, 'white-dragon-low.glb'), 6 * 1024 * 1024, 'LOD Low')
  }

  for (const message of warnings) console.warn(`ADVERTENCIA: ${message}`)

  if (errors.length > 0) {
    for (const message of errors) console.error(`ERROR: ${message}`)
    process.exitCode = 1
    return
  }

  console.log(
    manifest?.enabled
      ? 'Dragón Blanco: paquete habilitado y puertas de lanzamiento superadas.'
      : 'Dragón Blanco: contrato válido; el paquete 3D permanece desactivado de forma segura.',
  )
}

await main()
