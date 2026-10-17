export type AppConfig = {
  better_auth_url: string
  vapid_public_key: string
  app_base_url: string
  turnstile_site_key: string
  google_sign_in?: boolean
}

let cached: AppConfig | null = null

export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached
  const res = await fetch('/api/config')
  if (!res.ok) {
    throw new Error(`Failed to load /api/config (${res.status})`)
  }
  cached = (await res.json()) as AppConfig
  return cached
}
