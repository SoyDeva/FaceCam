import type { DragonLod } from './quality'

export interface DragonAssetLod {
  url: string
  maxTextureSize: number
  targetTriangles: number
}

export interface DragonNodeContract {
  root: string
  headRig: string
  jaw: string
  leftEye: string
  rightEye: string
  headMesh: string
  eyesMesh: string
  sigil: string
  neck: string
}

export interface DragonAssetManifest {
  schemaVersion: 1
  id: 'white-dragon'
  displayName: string
  enabled: boolean
  assetVersion: string
  contract: string
  basisTranscoderPath: string
  lods: Record<DragonLod, DragonAssetLod>
  nodes: DragonNodeContract
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assertManifest(value: unknown): asserts value is DragonAssetManifest {
  if (!isRecord(value)) throw new Error('El manifiesto del Dragón Blanco no es un objeto válido.')
  if (value.schemaVersion !== 1) throw new Error('Versión de manifiesto 3D no compatible.')
  if (value.id !== 'white-dragon') throw new Error('El manifiesto no pertenece al Dragón Blanco.')
  if (typeof value.enabled !== 'boolean') throw new Error('El manifiesto no define enabled.')
  if (!isRecord(value.lods) || !isRecord(value.nodes)) {
    throw new Error('El manifiesto 3D está incompleto.')
  }

  for (const lod of ['low', 'medium', 'high'] as const) {
    const candidate = value.lods[lod]
    if (!isRecord(candidate) || typeof candidate.url !== 'string') {
      throw new Error(`El manifiesto no define el LOD ${lod}.`)
    }
  }
}

export async function loadDragonManifest(
  signal?: AbortSignal,
): Promise<DragonAssetManifest> {
  const manifestUrl = `${import.meta.env.BASE_URL}models/white-dragon/manifest.json`
  const response = await fetch(manifestUrl, { signal, cache: 'no-cache' })
  if (!response.ok) {
    throw new Error(`No fue posible cargar el manifiesto 3D (${response.status}).`)
  }

  const value: unknown = await response.json()
  assertManifest(value)
  return value
}

export function resolvePublicAssetUrl(relativePath: string): string {
  return new URL(relativePath, new URL(import.meta.env.BASE_URL, window.location.origin)).toString()
}
