import { describe, expect, it } from 'vitest'
import { chooseDragonQuality } from './quality'

describe('chooseDragonQuality', () => {
  it('uses the safe profile for constrained mobile devices', () => {
    const profile = chooseDragonQuality({
      hardwareConcurrency: 4,
      deviceMemoryGb: 2,
      viewportWidth: 390,
      viewportHeight: 844,
      isMobile: true,
      isIos: true,
    })

    expect(profile.level).toBe('safe')
    expect(profile.lod).toBe('low')
    expect(profile.maxTextureSize).toBe(1024)
  })

  it('uses the high profile for capable mobile devices', () => {
    const profile = chooseDragonQuality({
      hardwareConcurrency: 8,
      deviceMemoryGb: 6,
      viewportWidth: 430,
      viewportHeight: 932,
      isMobile: true,
      isIos: false,
    })

    expect(profile.level).toBe('high')
    expect(profile.lod).toBe('medium')
  })

  it('reserves ultra for capable desktop devices', () => {
    const profile = chooseDragonQuality({
      hardwareConcurrency: 12,
      deviceMemoryGb: 16,
      viewportWidth: 1920,
      viewportHeight: 1080,
      isMobile: false,
      isIos: false,
    })

    expect(profile.level).toBe('ultra')
    expect(profile.lod).toBe('high')
  })
})
