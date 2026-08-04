import { FormEvent, useState } from 'react'
import { supabase } from '../config/supabase'
import { validateNickname, validatePassword } from '../shared/validation'
import type { AuthFunctionResponse } from './types'

type Mode = 'login' | 'register'

export function AuthPanel() {
  const [mode, setMode] = useState<Mode>('login')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const nicknameError = validateNickname(nickname)
    const passwordError = validatePassword(password)
    if (nicknameError || passwordError) {
      setError(nicknameError ?? passwordError)
      return
    }
    if (mode === 'register' && password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setLoading(true)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<AuthFunctionResponse>(
        mode === 'register' ? 'register-nickname' : 'login-nickname',
        { body: { nickname, password } },
      )
      if (invokeError) throw invokeError
      if (!data?.session) throw new Error(data?.error ?? 'No fue posible crear la sesión.')

      const { error: sessionError } = await supabase.auth.setSession(data.session)
      if (sessionError) throw sessionError
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Error inesperado.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="brand-mark" aria-hidden="true">✦</div>
      <p className="eyebrow">CÁMARA RITUAL</p>
      <h1 id="auth-title">FaceCam</h1>
      <p className="muted">Tu cámara se procesa en el dispositivo. Los videos nunca se suben a la nube.</p>

      <div className="segmented" aria-label="Modo de acceso">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')} type="button">
          Ingresar
        </button>
        <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')} type="button">
          Crear cuenta
        </button>
      </div>

      <form onSubmit={submit}>
        <label>
          Nickname
          <input
            autoComplete="username"
            maxLength={20}
            minLength={3}
            onChange={(event) => setNickname(event.target.value)}
            required
            value={nickname}
          />
        </label>
        <label>
          Contraseña
          <input
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            maxLength={64}
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        {mode === 'register' && (
          <label>
            Confirmar contraseña
            <input
              autoComplete="new-password"
              maxLength={64}
              minLength={8}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              type="password"
              value={confirmPassword}
            />
          </label>
        )}
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="primary-button" disabled={loading} type="submit">
          {loading ? 'Procesando…' : mode === 'register' ? 'Crear cuenta' : 'Ingresar'}
        </button>
      </form>
      <p className="fine-print">Sin correo no existe recuperación automática de contraseña.</p>
    </section>
  )
}
