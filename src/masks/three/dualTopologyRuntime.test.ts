import { describe, expect, it } from 'vitest'
import {
  SINGLE_SOURCE_JAW_DEADZONE,
  SINGLE_SOURCE_JAW_FULL,
  SINGLE_SOURCE_RENDERER_JAW_GAIN,
  resolveSingleSourceJaw,
} from './dualTopologyRuntime'

describe('resolveSingleSourceJaw v29 smooth-neutral contract', () => {
  it('holds the corrected neutral-close morph fully at rest', () => {
    const result = resolveSingleSourceJaw(0)
    expect(result.openAmount).toBe(0)
    expect(result.closeWeight).toBe(1)
    expect(result.rendererJawValue * SINGLE_SOURCE_RENDERER_JAW_GAIN).toBeCloseTo(1, 8)
  })

  it('keeps detector noise inside the mouth deadzone fully closed', () => {
    const result = resolveSingleSourceJaw(SINGLE_SOURCE_JAW_DEADZONE)
    expect(result.openAmount).toBe(0)
    expect(result.closeWeight).toBe(1)
  })

  it('opens continuously without any topology threshold or hysteresis', () => {
    const low = resolveSingleSourceJaw(0.18)
    const middle = resolveSingleSourceJaw(0.34)
    const high = resolveSingleSourceJaw(0.52)

    expect(low.openAmount).toBeGreaterThan(0)
    expect(middle.openAmount).toBeGreaterThan(low.openAmount)
    expect(high.openAmount).toBeGreaterThan(middle.openAmount)
    expect(low.closeWeight).toBeGreaterThan(middle.closeWeight)
    expect(middle.closeWeight).toBeGreaterThan(high.closeWeight)
  })

  it('maps the live automatic jaw ceiling to the exact authored open source', () => {
    const result = resolveSingleSourceJaw(SINGLE_SOURCE_JAW_FULL)
    expect(result.openAmount).toBe(1)
    expect(result.closeWeight).toBe(0)
    expect(result.rendererJawValue).toBe(0)
  })

  it('also keeps renderer-rig-test jawOpen=1 at the exact open endpoint', () => {
    expect(resolveSingleSourceJaw(1)).toEqual({
      openAmount: 1,
      closeWeight: 0,
      rendererJawValue: 0,
    })
  })

  it('clamps malformed values without changing the single-source endpoints', () => {
    expect(resolveSingleSourceJaw(-1).closeWeight).toBe(1)
    expect(resolveSingleSourceJaw(2).closeWeight).toBe(0)
  })
})
