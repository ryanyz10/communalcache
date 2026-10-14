import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { APIError } from 'better-auth/api'

export type AuthEnv = {
  DB: D1Database
  APP_BASE_URL: string
  BETTER_AUTH_URL: string
  BETTER_AUTH_SECRET: string
  RESEND_API_KEY: string
  EMAIL_FROM: string
}

export type DeliveryResult = { status: 'not_called' | 'sent' | 'failed' }

export function authOptions(env: AuthEnv, delivery?: DeliveryResult, requestPath?: string) {
  if (env.BETTER_AUTH_URL !== env.APP_BASE_URL) throw new Error('Auth URL must match app URL')
  const url = new URL(env.APP_BASE_URL)
  if (url.origin !== env.APP_BASE_URL) throw new Error('App URL must be an exact origin')
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('App URL must use HTTPS')
  }
  return {
    appName: 'Communal Cache',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [env.APP_BASE_URL],
    onAPIError: {
      onError(error) {
        // ponytail: 1.7.7 restores a wrong OTP after consuming it; a newer resend
        // wins our partial unique index. PR #10443 will classify this as INVALID_OTP upstream.
        if (requestPath === '/api/auth/sign-in/email-otp' && error instanceof Error &&
          /^D1_ERROR: UNIQUE constraint failed: verification\.identifier: SQLITE_CONSTRAINT(?: \(extended: SQLITE_CONSTRAINT_UNIQUE\))?$/.test(error.message)) {
          throw new APIError('BAD_REQUEST', { code: 'INVALID_OTP', message: 'Invalid OTP' })
        }
      },
    },
    emailAndPassword: { enabled: false },
    user: {
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
      additionalFields: {
        display_name: { type: 'string', required: false, input: false },
      },
    },
    session: { cookieCache: { enabled: false } },
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      database: { generateId: 'uuid' },
      useSecureCookies: url.protocol === 'https:',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/email-otp/send-verification-otp': { window: 60, max: 3 },
        '/sign-in/email-otp': { window: 60, max: 10 },
      },
    },
    plugins: [emailOTP({
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      storeOTP: 'hashed',
      resendStrategy: 'rotate',
      disableSignUp: false,
      async sendVerificationOTP({ email, otp }) {
        // Better Auth 1.7.7 catches callback errors (context/create-context.mjs:215–224).
        // This request's handler inspects the result after the awaited callback finishes.
        if (delivery) delivery.status = 'failed'
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM,
            to: [email],
            subject: 'Your Communal Cache sign-in code',
            text: `Your sign-in code is ${otp}. It expires in 5 minutes. Use the most recent code you requested, even if an older email arrives later.`,
          }),
        })
        await response.body?.cancel()
        if (!response.ok) throw new Error('Could not send sign-in code')
        if (delivery) delivery.status = 'sent'
      },
    })],
  } satisfies BetterAuthOptions
}

export function createAuth(env: AuthEnv, delivery?: DeliveryResult, requestPath?: string) {
  return betterAuth(authOptions(env, delivery, requestPath))
}
