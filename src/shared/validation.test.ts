import { describe, expect, it } from 'vitest'
import { formatDuration } from './format'
import { normalizeNickname, validateNickname, validatePassword } from './validation'

 describe('validación', () => {
  it('normaliza nicknames de forma consistente', () => {
    expect(normalizeNickname('  DéVa_01  ')).toBe('déva_01')
  })

  it('rechaza nicknames inválidos', () => {
    expect(validateNickname('ab')).not.toBeNull()
    expect(validateNickname('deva!')).not.toBeNull()
    expect(validateNickname('Soy_Deva')).toBeNull()
  })

  it('exige una contraseña razonable', () => {
    expect(validatePassword('1234567')).not.toBeNull()
    expect(validatePassword('dragon88')).toBeNull()
  })

  it('formatea la duración', () => {
    expect(formatDuration(65_000)).toBe('01:05')
  })
})
