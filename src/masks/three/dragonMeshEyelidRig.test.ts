import { describe, expect, it } from 'vitest'
import {
  resolveDragonEyelidCoverPose,
  resolveDragonMeshBlink,
} from './dragonMeshEyelidRig'

describe('resolveDragonMeshBlink', () => {
  it('keeps weak eyelid noise fully open', () => {
    expect(resolveDragonMeshBlink(0.08)).toBe(0)
  })

  it('turns a natural blink into a clear closure', () => {
    expect(resolveDragonMeshBlink(0.35)).toBeGreaterThan(0.68)
  })

  it('reaches full closure before the signal saturates', () => {
    expect(resolveDragonMeshBlink(0.52)).toBe(1)
    expect(resolveDragonMeshBlink(1)).toBe(1)
  })
})

describe('resolveDragonEyelidCoverPose', () => {
  const radiusY = 0.1

  it('keeps both independent eyelid covers hidden at rest', () => {
    const pose = resolveDragonEyelidCoverPose(0.08, radiusY)
    expect(pose.visible).toBe(false)
    expect(pose.closure).toBe(0)
    expect(pose.upperOffset).toBeCloseTo(radiusY * 0.94)
    expect(pose.lowerOffset).toBeCloseTo(-radiusY * 0.94)
  })

  it('moves the upper and lower lids toward the eye center during a blink', () => {
    const open = resolveDragonEyelidCoverPose(0.08, radiusY)
    const blinking = resolveDragonEyelidCoverPose(0.35, radiusY)

    expect(blinking.visible).toBe(true)
    expect(Math.abs(blinking.upperOffset)).toBeLessThan(Math.abs(open.upperOffset))
    expect(Math.abs(blinking.lowerOffset)).toBeLessThan(Math.abs(open.lowerOffset))
    expect(blinking.lidScaleY).toBeGreaterThan(radiusY * 0.68)
  })

  it('meets both lids at the center without moving any facial vertices', () => {
    const closed = resolveDragonEyelidCoverPose(0.52, radiusY)
    expect(closed.closure).toBe(1)
    expect(closed.upperOffset).toBe(0)
    expect(closed.lowerOffset).toBe(-0)
    expect(closed.lidScaleY).toBe(radiusY)
    expect(closed.seamOpacity).toBeGreaterThan(0.5)
  })
})
