import {
  DEFAULT_STATIC_DRAGON_CALIBRATION,
  type StaticDragonCalibration,
} from './StaticDragonRenderer'
import type { DragonExpressionCalibration } from './expressionCalibration'
import type { StaticDragonHeadCalibration } from './headCalibration'

const DATABASE_NAME = 'facecam-local-assets'
const DATABASE_VERSION = 1
const MODEL_STORE = 'models'
const WHITE_DRAGON_KEY = 'white-dragon-medium'
const CALIBRATION_KEY = 'facecam:white-dragon-calibration:v2'
const HEAD_CALIBRATION_KEY = 'facecam:white-dragon-head-calibration:v1'
const EXPRESSION_CALIBRATION_KEY = 'facecam:white-dragon-expression-calibration:v1'

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
  operation: (
    store: IDBObjectStore,
    setResult: (value: T) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<T> {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(MODEL_STORE, mode)
    const store = transaction.objectStore(MODEL_STORE)
    let result: T | undefined
    let hasResult = false
    let settled = false

    const setResult = (value: T) => {
      result = value
      hasResult = true
    }
    const safeReject = (reason?: unknown) => {
      if (settled) return
      settled = true
      database.close()
      reject(reason)
    }

    transaction.oncomplete = () => {
      if (settled) return
      settled = true
      database.close()
      if (!hasResult) {
        reject(new Error('La operación local terminó sin resultado.'))
        return
      }
      resolve(result as T)
    }
    transaction.onerror = () => {
      safeReject(transaction.error ?? new Error('Falló la operación de almacenamiento local.'))
    }
    transaction.onabort = () => {
      safeReject(transaction.error ?? new Error('La operación de almacenamiento local fue cancelada.'))
    }

    operation(store, setResult, safeReject)
  }))
}

export async function saveLocalDragonModel(blob: Blob, name: string): Promise<void> {
  const record: StoredDragonModel = {
    id: WHITE_DRAGON_KEY,
    name,
    blob,
    installedAt: Date.now(),
  }

  await runTransaction<void>('readwrite', (store, setResult, reject) => {
    const request = store.put(record)
    request.onsuccess = () => setResult(undefined)
    request.onerror = () => reject(request.error)
  })
}

export async function loadLocalDragonModel(): Promise<LocalDragonModel | null> {
  return runTransaction<LocalDragonModel | null>('readonly', (store, setResult, reject) => {
    const request = store.get(WHITE_DRAGON_KEY)
    request.onsuccess = () => {
      const record = request.result as StoredDragonModel | undefined
      if (!record?.blob) {
        setResult(null)
        return
      }
      setResult({
        name: record.name,
        blob: record.blob,
        installedAt: record.installedAt,
      })
    }
    request.onerror = () => reject(request.error)
  })
}

export async function removeLocalDragonModel(): Promise<void> {
  await runTransaction<void>('readwrite', (store, setResult, reject) => {
    const request = store.delete(WHITE_DRAGON_KEY)
    request.onsuccess = () => setResult(undefined)
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

export function loadLocalDragonHeadCalibration(): StaticDragonHeadCalibration | null {
  try {
    const raw = window.localStorage.getItem(HEAD_CALIBRATION_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<StaticDragonHeadCalibration>
    const baseFaceWidth = finiteNumber(value.baseFaceWidth, 0)
    const baseEyeDistance = finiteNumber(value.baseEyeDistance, 0)
    const baseFaceHeight = finiteNumber(value.baseFaceHeight, 0)
    const capturedAt = finiteNumber(value.capturedAt, 0)

    if (
      value.version !== 1
      || baseFaceWidth < 0.08
      || baseEyeDistance < 0.025
      || baseFaceHeight < 0.1
    ) {
      return null
    }

    return {
      version: 1,
      baseFaceWidth,
      baseEyeDistance,
      baseFaceHeight,
      capturedAt,
    }
  } catch {
    return null
  }
}

export function saveLocalDragonHeadCalibration(
  calibration: StaticDragonHeadCalibration,
): void {
  try {
    window.localStorage.setItem(HEAD_CALIBRATION_KEY, JSON.stringify(calibration))
  } catch (error) {
    console.warn('No fue posible guardar la forma calibrada de la cabeza.', error)
  }
}

export function removeLocalDragonHeadCalibration(): void {
  try {
    window.localStorage.removeItem(HEAD_CALIBRATION_KEY)
  } catch (error) {
    console.warn('No fue posible borrar la calibración de la cabeza.', error)
  }
}

export function loadLocalDragonExpressionCalibration(): DragonExpressionCalibration | null {
  try {
    const raw = window.localStorage.getItem(EXPRESSION_CALIBRATION_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<DragonExpressionCalibration>
    const calibration: DragonExpressionCalibration = {
      version: 1,
      jawNeutral: finiteNumber(value.jawNeutral, 0),
      jawSpeech: finiteNumber(value.jawSpeech, 0),
      mouthHeightNeutral: finiteNumber(value.mouthHeightNeutral, 0),
      mouthHeightSpeech: finiteNumber(value.mouthHeightSpeech, 0),
      mouthWidthNeutral: finiteNumber(value.mouthWidthNeutral, 0),
      mouthWidthSpeech: finiteNumber(value.mouthWidthSpeech, 0),
      leftEyeOpen: finiteNumber(value.leftEyeOpen, 0),
      leftEyeClosed: finiteNumber(value.leftEyeClosed, 0),
      rightEyeOpen: finiteNumber(value.rightEyeOpen, 0),
      rightEyeClosed: finiteNumber(value.rightEyeClosed, 0),
      leftBlinkOpen: finiteNumber(value.leftBlinkOpen, 0),
      leftBlinkClosed: finiteNumber(value.leftBlinkClosed, 0),
      rightBlinkOpen: finiteNumber(value.rightBlinkOpen, 0),
      rightBlinkClosed: finiteNumber(value.rightBlinkClosed, 0),
      quality: finiteNumber(value.quality, 0),
      capturedAt: finiteNumber(value.capturedAt, 0),
    }

    if (
      value.version !== 1
      || calibration.jawSpeech <= calibration.jawNeutral
      || calibration.mouthHeightSpeech <= calibration.mouthHeightNeutral
      || calibration.mouthWidthSpeech <= calibration.mouthWidthNeutral
      || calibration.leftEyeOpen <= calibration.leftEyeClosed
      || calibration.rightEyeOpen <= calibration.rightEyeClosed
      || calibration.leftBlinkClosed <= calibration.leftBlinkOpen
      || calibration.rightBlinkClosed <= calibration.rightBlinkOpen
      || calibration.quality < 0.1
    ) {
      return null
    }

    return calibration
  } catch {
    return null
  }
}

export function saveLocalDragonExpressionCalibration(
  calibration: DragonExpressionCalibration,
): void {
  try {
    window.localStorage.setItem(EXPRESSION_CALIBRATION_KEY, JSON.stringify(calibration))
  } catch (error) {
    console.warn('No fue posible guardar la calibración facial del dragón.', error)
  }
}

export function removeLocalDragonExpressionCalibration(): void {
  try {
    window.localStorage.removeItem(EXPRESSION_CALIBRATION_KEY)
  } catch (error) {
    console.warn('No fue posible borrar la calibración facial del dragón.', error)
  }
}
