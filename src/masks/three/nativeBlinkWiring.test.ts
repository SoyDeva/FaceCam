// @ts-nocheck
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('v7 guarded mesh eyelid wiring', () => {
  it('drives real eye-region geometry without routing blinks through GLB morphs', () => {
    const source = fs.readFileSync('src/masks/three/StaticDragonRenderer.ts', 'utf8')
    expect(source).toContain('createDragonMeshEyelidRig')
    expect(source).toContain('applyDragonMeshEyelidRig')
    expect(source).toContain('this.hasNativeBlink = false')
    expect(source).not.toContain("this.setMorph(binding, 'blinkLeft', expression.blinkLeft)")
    expect(source).not.toContain("this.setMorph(binding, 'blinkRight', expression.blinkRight)")
    expect(source).toContain("this.setMorph(binding, 'jawOpen', expression.jawOpen)")
  })
})
