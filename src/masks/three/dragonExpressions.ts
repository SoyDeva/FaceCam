import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'

export interface DragonExpressionState {
  jawOpen: number
  blinkLeft: number
  blinkRight: number
  gazeX: number
  gazeY: number
  smile: number
  browRaise: number
}

export const NEUTRAL_DRAGON_EXPRESSION: DragonExpressionState = {
  jawOpen: 0,
  blinkLeft: 0,
  blinkRight: 0,
  gazeX: 0,
  gazeY: 0,
  smile: 0,
  browRaise: 0,
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0))
  return amount * amount * (3 - 2 * amount)
}

function lerp(previous: number, next: number, alpha: number): number {
  return previous + (next - previous) * alpha
}

function blendshapeMap(result: FaceLandmarkerResult | null): Map<string, number> {
  const categories = result?.faceBlendshapes[0]?.categories ?? []
  return new Map(categories.map((category) => [category.categoryName, category.score]))
}

function score(scores: Map<string, number>, name: string): number {
  return clamp(scores.get(name) ?? 0)
}

export function estimateDragonExpression(
  result: FaceLandmarkerResult | null,
): DragonExpressionState {
  const scores = blendshapeMap(result)
  if (!scores.size) return { ...NEUTRAL_DRAGON_EXPRESSION }

  const lookOutLeft = score(scores, 'eyeLookOutLeft')
  const lookInLeft = score(scores, 'eyeLookInLeft')
  const lookInRight = score(scores, 'eyeLookInRight')
  const lookOutRight = score(scores, 'eyeLookOutRight')
  const lookDown = (score(scores, 'eyeLookDownLeft') + score(scores, 'eyeLookDownRight')) / 2
  const lookUp = (score(scores, 'eyeLookUpLeft') + score(scores, 'eyeLookUpRight')) / 2

  return {
    jawOpen: smoothstep(0.035, 0.72, score(scores, 'jawOpen')),
    blinkLeft: smoothstep(0.08, 0.82, score(scores, 'eyeBlinkLeft')),
    blinkRight: smoothstep(0.08, 0.82, score(scores, 'eyeBlinkRight')),
    gazeX: clamp(
      ((lookOutLeft - lookInLeft) + (lookInRight - lookOutRight)) / 2,
      -1,
      1,
    ),
    gazeY: clamp(lookDown - lookUp, -1, 1),
    smile: smoothstep(
      0.04,
      0.75,
      (score(scores, 'mouthSmileLeft') + score(scores, 'mouthSmileRight')) / 2,
    ),
    browRaise: smoothstep(
      0.04,
      0.7,
      (
        score(scores, 'browInnerUp')
        + score(scores, 'browOuterUpLeft')
        + score(scores, 'browOuterUpRight')
      ) / 3,
    ),
  }
}

export function smoothDragonExpression(
  previous: DragonExpressionState,
  next: DragonExpressionState,
  alpha = 0.38,
): DragonExpressionState {
  const amount = clamp(alpha)
  const fastBlink = Math.max(amount, 0.62)

  return {
    jawOpen: lerp(previous.jawOpen, next.jawOpen, amount),
    blinkLeft: lerp(previous.blinkLeft, next.blinkLeft, fastBlink),
    blinkRight: lerp(previous.blinkRight, next.blinkRight, fastBlink),
    gazeX: lerp(previous.gazeX, next.gazeX, amount),
    gazeY: lerp(previous.gazeY, next.gazeY, amount),
    smile: lerp(previous.smile, next.smile, amount),
    browRaise: lerp(previous.browRaise, next.browRaise, amount),
  }
}
