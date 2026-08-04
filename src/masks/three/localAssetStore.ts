import {
  DEFAULT_STATIC_DRAGON_CALIBRATION,
  type StaticDragonCalibration,
} from './StaticDragonRenderer'

const DATABASE_NAME = 'facecam-local-assets'
const DATABASE_VERSION = 1
const MODEL_STORE = 'models'
const WHITE_DRAGON_KEY = 'white-dragon-medium'
const CALIBRATION_KEY = 'facecam:white-dragon-calibration:v1'

interface StoredDragonModel {
  id: typeof WHITE_DRAGON_KEY
  name: string
  blob: Blob
  installedAt: number
}

export interface LocalDragonModel {
  name: string
  blob: Blob
  installedAt: number
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) {
    return Promise.reject(new Error('Este navegador no permite guardar el modelo 3D localmente.'))
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(MODEL_STORE)) {
        database.createObjectStore(MODEL_STORE, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('No fue posible abrir el almacenamiento local.'))
    request.onblocked = () => reject(new Error('El almacenamiento local está bloqueado por otra pestaña.'))
  })
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
): Promise<T> {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(MODEL_STORE, mode)
    const store = transaction.objectStore(MODEL_STORE)
    let settled = false

    const safeResolve = (value: T) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const safeReject = (reason?: unknown) => {
      if (settled) return
      settled = true
      reject(reason)
    }

    transaction.oncomplete = () => database.close()
    transaction.onerror = () => {
      database.close()
      safeReject(transaction.error ?? new Error('Falló la operación de almacenamiento local.'))
    }
    transaction.onabort = () => {
      database.close()
      safeReject(transaction.error ?? new Error('La operación de almacenamiento local fue cancelada.'))
    }

    operation(store, safeResolve, safeReject)
  }))
}

export async function saveLocalDragonModel(blob: Blob, name: string): Promise<void> {
  const record: StoredDragonModel = {
    id: WHITE_DRAGON_KEY,
    name,
    blob,
    installedAt: Date.now(),
  }

  await runTransaction<void>('readwrite', (store, resolve, reject) => {
    const request = store.put(record)
    request.onsuccess = () => resolve(undefined)
    request.onerror = () => reject(request.error)
  })
}

export async function loadLocalDragonModel(): Promise<LocalDragonModel | null> {
  return runTransaction<LocalDragonModel | null>('readonly', (store, resolve, reject) => {
    const request = store.get(WHITE_DRAGON_KEY)
    request.onsuccess = () => {
      const record = request.result as StoredDragonModel | undefined
      if (!record?.blob) {
        resolve(null)
        return
      }
      resolve({
        name: record.name,
        blob: record.blob,
        installedAt: record.installedAt,
      })
    }
    request.onerror = () => reject(request.error)
  })
}

export async function removeLocalDragonModel(): Promise<void> {
  await runTransaction<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(WHITE_DRAGON_KEY)
    request.onsuccess = () => resolve(undefined)
    request.onerror = () => reject(request.error)
  })
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function loadLocalDragonCalibration(): StaticDragonCalibration {
  try {
    const raw = window.localStorage.getItem(CALIBRATION_KEY)
    if (!raw) return { ...DEFAULT_STATIC_DRAGON_CALIBRATION }
    const value = JSON.parse(raw) as Partial<StaticDragonCalibration>

    return {
      scaleMultiplier: finiteNumber(value.scaleMultiplier, DEFAULT_STATIC_DRAGON_CALIBRATION.scaleMultiplier),
      offsetX: finiteNumber(value.offsetX, DEFAULT_STATIC_DRAGON_CALIBRATION.offsetX),
      offsetY: finiteNumber(value.offsetY, DEFAULT_STATIC_DRAGON_CALIBRATION.offsetY),
      yawMultiplier: finiteNumber(value.yawMultiplier, DEFAULT_STATIC_DRAGON_CALIBRATION.yawMultiplier),
      pitchMultiplier: finiteNumber(value.pitchMultiplier, DEFAULT_STATIC_DRAGON_CALIBRATION.pitchMultiplier),
      facingReversed: typeof value.facingReversed === 'boolean'
        ? value.facingReversed
        : DEFAULT_STATIC_DRAGON_CALIBRATION.facingReversed,
      coverageShield: typeof value.coverageShield === 'boolean'
        ? value.coverageShield
        : DEFAULT_STATIC_DRAGON_CALIBRATION.coverageShield,
    }
  } catch {
    return { ...DEFAULT_STATIC_DRAGON_CALIBRATION }
  }
}

export function saveLocalDragonCalibration(calibration: StaticDragonCalibration): void {
  try {
    window.localStorage.setItem(CALIBRATION_KEY, JSON.stringify(calibration))
  } catch (error) {
    console.warn('No fue posible guardar la calibración local del dragón.', error)
  }
}
