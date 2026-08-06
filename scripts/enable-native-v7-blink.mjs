import fs from 'node:fs'

const rendererPath = 'src/masks/three/StaticDragonRenderer.ts'
const workflowPath = '.github/workflows/enable-native-v7-blink.yml'
let source = fs.readFileSync(rendererPath, 'utf8')

function replaceExact(before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`No se encontró el bloque esperado: ${label}`)
  }
  source = source.replace(before, after)
}

replaceExact(
`import {
  applyDragonMeshEyelidRig,
  createDragonMeshEyelidRig,
  type DragonMeshEyelidBinding,
} from './dragonMeshEyelidRig'
`,
'',
'import procedural eyelids',
)

replaceExact(
`  blinkLeft: { gain: 2.25, max: 2 },
  blinkRight: { gain: 2.25, max: 2 },`,
`  blinkLeft: { gain: 1, max: 1 },
  blinkRight: { gain: 1, max: 1 },`,
'blink morph response',
)

replaceExact(
`  private readonly privacyMesh: Mesh
  private proceduralEyelids: DragonMeshEyelidBinding[] = []
`,
`  private readonly privacyMesh: Mesh
`,
'procedural eyelid field',
)

replaceExact(
`      this.hasNativeJaw = this.hasMorph('jawOpen')
      // The installed dragon advertises blink morphs, but they deform the
      // snout instead of closing the eyelids. Keep them disabled and move
      // only the dragon mesh vertices around each real eye.
      this.hasNativeBlink = false
`,
`      this.hasNativeJaw = this.hasMorph('jawOpen')
      this.hasNativeBlink = this.hasMorph('blinkLeft') && this.hasMorph('blinkRight')
      if (!this.hasNativeBlink) {
        throw new Error('El GLB no contiene los morph targets nativos de ambos párpados.')
      }
`,
'native blink detection',
)

replaceExact(
`      this.proceduralEyelids = createDragonMeshEyelidRig(
        gltf.scene,
        bounds,
        size,
        center,
        modelEyeY,
      )
`,
'',
'procedural eyelid creation',
)

replaceExact(
`    for (const binding of this.morphBindings) {
      this.setMorph(binding, 'jawOpen', expression.jawOpen)
`,
`    for (const binding of this.morphBindings) {
      this.setMorph(binding, 'jawOpen', expression.jawOpen)
      this.setMorph(binding, 'blinkLeft', expression.blinkLeft)
      this.setMorph(binding, 'blinkRight', expression.blinkRight)
`,
'native blink writes',
)

replaceExact(
`
    applyDragonMeshEyelidRig(
      this.proceduralEyelids,
      expression.blinkLeft,
      expression.blinkRight,
    )
`,
'',
'procedural blink application',
)

replaceExact(
`    this.hasNativeGaze = false
    this.proceduralEyelids.length = 0
`,
`    this.hasNativeGaze = false
`,
'procedural eyelid disposal',
)

fs.writeFileSync(rendererPath, source)

const testPath = 'src/masks/three/nativeBlinkWiring.test.ts'
fs.writeFileSync(testPath, `import fs from 'node:fs'\nimport { describe, expect, it } from 'vitest'\n\ndescribe('native v7 blink wiring', () => {\n  it('writes both eye signals directly to the GLB morph targets', () => {\n    const source = fs.readFileSync('src/masks/three/StaticDragonRenderer.ts', 'utf8')\n    expect(source).toContain("this.hasNativeBlink = this.hasMorph('blinkLeft') && this.hasMorph('blinkRight')")\n    expect(source).toContain("this.setMorph(binding, 'blinkLeft', expression.blinkLeft)")\n    expect(source).toContain("this.setMorph(binding, 'blinkRight', expression.blinkRight)")\n    expect(source).not.toContain('applyDragonMeshEyelidRig')\n    expect(source).not.toContain('createDragonMeshEyelidRig')\n  })\n})\n`)

for (const path of [workflowPath, 'scripts/enable-native-v7-blink.mjs']) {
  if (fs.existsSync(path)) fs.unlinkSync(path)
}
