import fs from 'node:fs'

const expressionPath = 'src/masks/three/dragonExpressions.ts'
const testPath = 'src/masks/three/dragonExpressions.test.ts'
const workflowPath = '.github/workflows/stop-blink-mouth-crosstalk.yml'
const scriptPath = 'scripts/stop-blink-mouth-crosstalk.mjs'

let expression = fs.readFileSync(expressionPath, 'utf8')

function replaceExact(before, after, label) {
  if (!expression.includes(before)) throw new Error(`No se encontró: ${label}`)
  expression = expression.replace(before, after)
}

replaceExact(
`  const blinkRight = resolveEyeBlink(
    metrics.rightEyeOpening,
    rawRightBlink,
    runtimeRightBlink,
    calibratedRightBlink,
  )
`,
`  const blinkRight = resolveEyeBlink(
    metrics.rightEyeOpening,
    rawRightBlink,
    runtimeRightBlink,
    calibratedRightBlink,
  )
  const blinkEnergy = Math.max(blinkLeft, blinkRight)
`,
'blink energy',
)

replaceExact(
`  const mouthClose = score(scores, 'mouthClose')

  // Closed lips always win over a noisy jawOpen blendshape. This prevents the
  // mouth from talking by itself after an imperfect recalibration.
  const neutralLock = metrics.mouthHeight <= closedLipLimit || mouthClose >= 0.58
  const articulatedJaw = Math.pow(rawJaw, 0.9) * 0.82
  const jawOpen = neutralLock || rawJaw < 0.1
    ? 0
    : clamp(articulatedJaw - (rawJaw < 0.3 ? mouthClose * 0.12 : 0))
`,
`  const mouthClose = score(scores, 'mouthClose')

  // Blinking can produce a false jawOpen spike on some faces/cameras. During
  // eye closure, the jaw is therefore allowed to move only when the lips show
  // independent, clearly speech-sized separation. This keeps eye motion from
  // ever driving the mouth while preserving real speech during a blink.
  const blinkLipRequirement = 0.26 + blinkEnergy * 0.16
  const hasConfirmedLipSeparation = lipEvidence >= blinkLipRequirement
    && metrics.mouthHeight >= calibration.mouthHeightNeutral + heightRange * 0.24
  const blinkMouthLock = blinkEnergy >= 0.28 && !hasConfirmedLipSeparation

  // Closed lips always win over a noisy jawOpen blendshape. This prevents the
  // mouth from talking by itself after an imperfect recalibration.
  const neutralLock = metrics.mouthHeight <= closedLipLimit || mouthClose >= 0.58
  const articulatedJaw = Math.pow(rawJaw, 0.9) * 0.82
  const jawOpen = neutralLock || blinkMouthLock || rawJaw < 0.1
    ? 0
    : clamp(articulatedJaw - (rawJaw < 0.3 ? mouthClose * 0.12 : 0))
`,
'blink mouth lock',
)

fs.writeFileSync(expressionPath, expression)

let tests = fs.readFileSync(testPath, 'utf8')
const marker = `  it('keeps a short natural blink visibly above half travel', () => {
    const expression = estimateDragonExpression(resultFor(0.04, 0.012, 0.125, 0.25), calibration)
    expect(expression.blinkLeft).toBeGreaterThan(0.5)
    expect(expression.blinkRight).toBeGreaterThan(0.5)
  })
`
if (!tests.includes(marker)) throw new Error('No se encontró el punto de inserción de pruebas')
tests = tests.replace(marker, `${marker}
  it('keeps the mouth closed when a blink produces a false jaw spike', () => {
    const expression = estimateDragonExpression(
      resultFor(0.95, 0.018, 0.035, 0.9),
      calibration,
    )
    expect(expression.blinkLeft).toBeGreaterThan(0.8)
    expect(expression.blinkRight).toBeGreaterThan(0.8)
    expect(expression.jawOpen).toBe(0)
  })

  it('still permits real speech during a blink when lips are clearly separated', () => {
    const expression = estimateDragonExpression(
      resultFor(0.14, 0.03, 0.035, 0.9),
      calibration,
    )
    expect(expression.blinkLeft).toBeGreaterThan(0.8)
    expect(expression.blinkRight).toBeGreaterThan(0.8)
    expect(expression.jawOpen).toBeGreaterThan(0.45)
  })
`)
fs.writeFileSync(testPath, tests)

for (const path of [workflowPath, scriptPath, 'package-lock.json']) {
  if (fs.existsSync(path)) fs.unlinkSync(path)
}
