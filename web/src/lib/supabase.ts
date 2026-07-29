import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppConfig } from './config'

let client: SupabaseClient | null = null

export function getSupabase(cfg: AppConfig): SupabaseClient {
  if (!client) {
    client = createClient(cfg.supabase_url, cfg.supabase_anon_key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return client
}
