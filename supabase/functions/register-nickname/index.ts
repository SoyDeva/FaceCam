import { createClient } from 'npm:@supabase/supabase-js@2.110.6'
import { corsHeaders, json } from '../_shared/http.ts'
import { technicalEmail, validateCredentials } from '../_shared/identity.ts'

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) })
  if (request.method !== 'POST') return json(request, { error: 'Método no permitido.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !serviceRoleKey || !publishableKey) {
    return json(request, { error: 'El servicio de autenticación no está configurado.' }, 500)
  }

  let credentials
  try {
    const body = await request.json()
    credentials = validateCredentials(body.nickname, body.password)
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : 'Solicitud inválida.' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const publicClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = await technicalEmail(credentials.normalized)
  const nonce = crypto.randomUUID()

  const { error: nonceError } = await admin.from('registration_nonces').insert({
    nonce,
    nickname_normalized: credentials.normalized,
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  })
  if (nonceError) return json(request, { error: 'Ese nickname ya está ocupado.' }, 409)

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: credentials.password,
    email_confirm: true,
    user_metadata: {
      nickname: credentials.nickname,
      nickname_normalized: credentials.normalized,
      registration_nonce: nonce,
    },
  })

  if (createError || !created.user) {
    await admin.from('registration_nonces').delete().eq('nonce', nonce)
    const duplicate = createError?.message.toLowerCase().includes('already')
    return json(request, { error: duplicate ? 'Ese nickname ya está ocupado.' : 'No fue posible crear la cuenta.' }, duplicate ? 409 : 400)
  }

  const { data: login, error: loginError } = await publicClient.auth.signInWithPassword({
    email,
    password: credentials.password,
  })
  if (loginError || !login.session) return json(request, { error: 'Cuenta creada, pero no se pudo iniciar sesión.' }, 500)

  return json(request, {
    user: { id: created.user.id },
    session: {
      access_token: login.session.access_token,
      refresh_token: login.session.refresh_token,
    },
  }, 201)
})
