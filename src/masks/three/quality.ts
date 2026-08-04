export type DragonQualityLevel = 'safe' | 'high' | 'ultra'
export type DragonLod = 'low' | 'medium' | 'high'

export interface DragonQualityProfile {
  level: DragonQualityLevel
  lod: DragonLod
  maxPixelRatio: number
  maxTextureSize: 1024 | 2048 | 4096
  antialias: boolean
  targetFps: 24 | 30
  useAmbientOcclusion: boolean
  useBloom: boolean
}

export interface DevicePerformanceHints {
  hardwareConcurrency?: number
  deviceMemoryGb?: number
  viewportWidth: number
  viewportHeight: number
  isMobile: boolean
  isIos: boolean
}

const PROFILES: Record<DragonQualityLevel, DragonQualityProfile> = {
  safe: {
    level: 'safe',
    lod: 'low',
    maxPixelRatio: 1,
    maxTextureSize: 1024,
    antialias: false,
    targetFps: 24,
    useAmbientOcclusion: false,
    useBloom: false,
  },
  high: {
    level: 'high',
    lod: 'medium',
    maxPixelRatio: 1.5,
    maxTextureSize: 2048,
    antialias: true,
    targetFps: 30,
    useAmbientOcclusion: true,
    useBloom: true,
  },
  ultra: {
    level: 'ultra',
    lod: 'high',
    maxPixelRatio: 2,
    maxTextureSize: 4096,
    antialias: true,
    targetFps: 30,
    useAmbientOcclusion: true,
    useBloom: true,
  },
}

export function chooseDragonQuality(hints: DevicePerformanceHints): DragonQualityProfile {
  const cores = hints.hardwareConcurrency ?? 4
  const memory = hints.deviceMemoryGb ?? (hints.isIos ? 4 : 2)
  const viewportPixels = hints.viewportWidth * hints.viewportHeight

  if (cores <= 4 || memory <= 2 || viewportPixels > 3_700_000) {
    return PROFILES.safe
  }

  if (!hints.isMobile && cores >= 10 && memory >= 8 && viewportPixels <= 2_600_000) {
    return PROFILES.ultra
  }

  return PROFILES.high
}

interface NavigatorPerformanceHints extends Navigator {
  deviceMemory?: number
}

export function readDevicePerformanceHints(): DevicePerformanceHints {
  const navigatorWithMemory = navigator as NavigatorPerformanceHints
  const userAgent = navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(userAgent)
  const isMobile = isIos || /Android|Mobile/.test(userAgent)

  return {
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: navigatorWithMemory.deviceMemory,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    isMobile,
    isIos,
  }
}
