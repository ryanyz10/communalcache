interface Env {
  CF_ACCESS_TEAM_DOMAIN?: string
  CF_ACCESS_AUD?: string
  ADMIN_USER_IDS?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  BETTER_AUTH_SECRET: string
  RESEND_API_KEY: string
  VAPID_PRIVATE_KEY: string
}

declare namespace Cloudflare {
  interface Env {
    CF_ACCESS_TEAM_DOMAIN?: string
    CF_ACCESS_AUD?: string
    ADMIN_USER_IDS?: string
    GOOGLE_CLIENT_ID?: string
    GOOGLE_CLIENT_SECRET?: string
    BETTER_AUTH_SECRET: string
    RESEND_API_KEY: string
    VAPID_PRIVATE_KEY: string
  }
}
