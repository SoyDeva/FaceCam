import { createClient } from '@supabase/supabase-js'
import { runtimeConfig } from './runtime'

export const supabase = createClient(
  runtimeConfig.supabaseUrl,
  runtimeConfig.supabasePublishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
)
