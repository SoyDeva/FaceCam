const NICKNAME_PATTERN = /^[a-z0-9_-]+$/

export function normalizeNickname(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

export function validateNickname(value: string): string | null {
  const normalized = normalizeNickname(value)
  if (normalized.length < 3 || normalized.length > 20) {
    return 'El nickname debe tener entre 3 y 20 caracteres.'
  }
  if (!NICKNAME_PATTERN.test(normalized)) {
    return 'Usa letras sin espacios, números, guion o guion bajo.'
  }
  return null
}

export function validatePassword(value: string): string | null {
  if (value.length < 8 || value.length > 64) {
    return 'La contraseña debe tener entre 8 y 64 caracteres.'
  }
  return null
}
