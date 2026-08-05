import { describe, expect, it } from 'vitest'
import { resolveDragonEyelidClosure } from './dragonEyelidFallback'

describe('resolveDragonEyelidClosure', () => {
  it('keeps neutral camera jitter fully transparent', () => {
    expect(resolveDragonEyelidClosure(0)).toBe(0)
    expect(resolveDragonEyelidClosure(0.03)).toBe(0)
  })

  it('amplifies a moderate natural blink into a visible eyelid closure', () => {
    expect(resolveDragonEyelidClosure(0.3)).toBeGreaterThan(0.55)
  })

  it('reaches complete closure before the tracking signal saturates', () => {
    expect(resolveDragonEyelidClosure(0.585)).toBe(1)
    expect(resolveDragonEyelidClosure(1)).toBe(1)
  })
})
