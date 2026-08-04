export const runtimeConfig = {
  supabaseUrl:
    import.meta.env.VITE_SUPABASE_URL ?? 'https://rzzyepckmmbwyyvtkopr.supabase.co',
  supabasePublishableKey:
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    'sb_publishable_gnGwyY493eOnrSVpx9rpOg_fPJzTt6-',
  maxRecordingMs: 30 * 60 * 1000,
  outputWidth: 1280,
  outputHeight: 720,
} as const
