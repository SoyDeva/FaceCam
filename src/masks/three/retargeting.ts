import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'

export const DRAGON_MORPH_TARGETS = [
  'blinkLeft',
  'blinkRight',
  'squintLeft',
  'squintRight',
  'eyeWideLeft',
  'eyeWideRight',
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'jawOpen',
  'jawForward',
  'jawLeft',
  'jawRight',
  'mouthClose',
  'mouthFunnel',
  'mouthPucker',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthPressLeft',
  'mouthPressRight',
  'noseSneerLeft',
  'noseSneerRight',
  'nostrilFlare',
] as const

export type DragonMorphTarget = (typeof DRAGON_MORPH_TARGETS)[number]
export type DragonExpressionFrame = Record<DragonMorphTarget, number>

const SOURCE_TO_TARGET: Partial<Record<string, DragonMorphTarget>> = {
  eyeBlinkLeft: 'blinkLeft',
  eyeBlinkRight: 'blinkRight',
  eyeSquintLeft: 'squintLeft',
  eyeSquintRight: 'squintRight',
  eyeWideLeft: 'eyeWideLeft',
  eyeWideRight: 'eyeWideRight',
  browDownLeft: 'browDownLeft',
  browDownRight: 'browDownRight',
  browInnerUp: 'browInnerUp',
  jawOpen: 'jawOpen',
  jawForward: 'jawForward',
  jawLeft: 'jawLeft',
  jawRight: 'jawRight',
  mouthClose: 'mouthClose',
  mouthFunnel: 'mouthFunnel',
  mouthPucker: 'mouthPucker',
  mouthSmileLeft: 'mouthSmileLeft',
  mouthSmileRight: 'mouthSmileRight',
  mouthFrownLeft: 'mouthFrownLeft',
  mouthFrownRight: 'mouthFrownRight',
  mouthUpperUpLeft: 'mouthUpperUpLeft',
  mouthUpperUpRight: 'mouthUpperUpRight',
  mouthLowerDownLeft: 'mouthLowerDownLeft',
  mouthLowerDownRight: 'mouthLowerDownRight',
  mouthPressLeft: 'mouthPressLeft',
  mouthPressRight: 'mouthPressRight',
  noseSneerLeft: 'noseSneerLeft',
  noseSneerRight: 'noseSneerRight',
}

const TARGET_GAIN: Partial<Record<DragonMorphTarget, number>> = {
  jawOpen: 0.9,
  mouthSmileLeft: 0.45,
  mouthSmileRight: 0.45,
  mouthFrownLeft: 0.55,
  mouthFrownRight: 0.55,
  mouthPucker: 0.6,
  mouthFunnel: 0.7,
  browInnerUp: 0.5,
  noseSneerLeft: 0.6,
  noseSneerRight: 0.6,
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function createNeutralDragonExpression(): DragonExpressionFrame {
  return Object.fromEntries(DRAGON_MORPH_TARGETS.map((target) => [target, 0])) as DragonExpressionFrame
}

export function retargetFaceExpression(
  result: FaceLandmarkerResult | null,
): DragonExpressionFrame {
  const frame = createNeutralDragonExpression()
  const categories = result?.faceBlendshapes[0]?.categories ?? []

  for (const category of categories) {
    const target = SOURCE_TO_TARGET[category.categoryName]
    if (!target) continue
    const gain = TARGET_GAIN[target] ?? 1
    frame[target] = clamp01(category.score * gain)
  }

  const sneerAverage = (frame.noseSneerLeft + frame.noseSneerRight) / 2
  const jawContribution = frame.jawOpen * 0.12
  frame.nostrilFlare = clamp01(sneerAverage * 0.75 + jawContribution)

  return frame
}

export class DragonExpressionSmoother {
  private current = createNeutralDragonExpression()

  update(next: DragonExpressionFrame, deltaMs: number): DragonExpressionFrame {
    const response = 1 - Math.exp(-Math.max(0, deltaMs) / 55)
    const output = createNeutralDragonExpression()

    for (const target of DRAGON_MORPH_TARGETS) {
      const fastResponse = target.startsWith('blink') ? Math.min(1, response * 2.2) : response
      this.current[target] += (next[target] - this.current[target]) * fastResponse
      output[target] = this.current[target]
    }

    return output
  }

  reset(): void {
    this.current = createNeutralDragonExpression()
  }
}
