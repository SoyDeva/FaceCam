// @ts-nocheck
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('native v7 blink wiring', () => {
  it('writes both eye signals directly to the GLB morph targets', () => {
    const source = fs.readFileSync('src/masks/three/StaticDragonRenderer.ts', 'utf8')
    expect(source).toContain("this.hasNativeBlink = this.hasMorph('blinkLeft') && this.hasMorph('blinkRight')")
    expect(source).toContain("this.setMorph(binding, 'blinkLeft', expression.blinkLeft)")
    expect(source).toContain("this.setMorph(binding, 'blinkRight', expression.blinkRight)")
    expect(source).not.toContain('applyDragonMeshEyelidRig')
    expect(source).not.toContain('createDragonMeshEyelidRig')
  })
})
