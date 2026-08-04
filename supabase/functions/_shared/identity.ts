export function normalizeNickname(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

export function validateCredentials(nickname: unknown, password: unknown): { nickname: string; normalized: string; password: string } {
  if (typeof nickname !== 'string' || typeof password !== 'string') {
    throw new Error('Nickname y contraseña son obligatorios.')
  }
  const normalized = normalizeNickname(nickname)
  if (normalized.length < 3 || normalized.length > 20 || !/^[a-z0-9_-]+$/.test(normalized)) {
    throw new Error('El nickname no cumple los requisitos.')
  }
  if (password.length < 8 || password.length > 64) {
    throw new Error('La contraseña debe tener entre 8 y 64 caracteres.')
  }
  return { nickname: nickname.normalize('NFKC').trim(), normalized, password }
}

export async function technicalEmail(normalizedNickname: string): Promise<string> {
  const input = new TextEncoder().encode(normalizedNickname)
  const digest = await crypto.subtle.digest('SHA-256', input)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex}@users.facecam.invalid`
}
