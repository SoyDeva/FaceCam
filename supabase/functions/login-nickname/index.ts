import { createClient } from 'npm:@supabase/supabase-js@2.110.6'
import { corsHeaders, json } from '../_shared/http.ts'
import { technicalEmail, validateCredentials } from '../_shared/identity.ts'

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) })
  if (request.method !== 'POST') return json(request, { error: 'Método no permitido.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !publishableKey) {
    return json(request, { error: 'El servicio de autenticación no está configurado.' }, 500)
  }

  let credentials
  try {
    const body = await request.json()
    credentials = validateCredentials(body.nickname, body.password)
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : 'Solicitud inválida.' }, 400)
  }

  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = await technicalEmail(credentials.normalized)
  const { data, error } = await client.auth.signInWithPassword({ email, password: credentials.password })
  if (error || !data.session || !data.user) {
    return json(request, { error: 'Nickname o contraseña incorrectos.' }, 401)
  }

  return json(request, {
    user: { id: data.user.id },
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
  })
})
