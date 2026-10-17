interface Env {
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  BETTER_AUTH_SECRET: string
  RESEND_API_KEY: string
  VAPID_PRIVATE_KEY: string
}

declare namespace Cloudflare {
  interface Env {
    GOOGLE_CLIENT_ID?: string
    GOOGLE_CLIENT_SECRET?: string
    BETTER_AUTH_SECRET: string
    RESEND_API_KEY: string
    VAPID_PRIVATE_KEY: string
  }
}
