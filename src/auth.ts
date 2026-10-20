import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { magicLink } from 'better-auth/plugins/magic-link'
import { magicLandingUrl } from './magic-links'
import { escapeHtml } from './notifications'
import { APIError } from 'better-auth/api'
import { featureEnabled } from './db/flags'
import { sendAuthMail } from './auth-mail'

export type AuthEnv = {
  DB: D1Database
  APP_BASE_URL: string
  BETTER_AUTH_URL: string
  BETTER_AUTH_SECRET: string
  RESEND_API_KEY?: string
  LOCAL_DEV_AUTH?: string
  EMAIL_FROM: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
}

export function googleConfigured(env: Pick<AuthEnv, 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
}

export async function googleSignInEnabled(env: Pick<AuthEnv, 'DB' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>) {
  return googleConfigured(env) && await featureEnabled(env.DB, 'google_sign_in')
}

// 1.7.7 merges hook data before every account write; omission would retain tokens.
async function discardOAuthTokens() {
  return { data: { accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null } }
}

export type DeliveryResult = { status: 'not_called' | 'sent' | 'failed' }

export function authOptions(env: AuthEnv, delivery?: DeliveryResult, requestPath?: string, requestUrl?: string) {
  if (env.BETTER_AUTH_URL !== env.APP_BASE_URL) throw new Error('Auth URL must match app URL')
  const appUrl = new URL(env.APP_BASE_URL)
  if (appUrl.origin !== env.APP_BASE_URL) throw new Error('App URL must be an exact origin')
  if (appUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(appUrl.hostname)) {
    throw new Error('App URL must use HTTPS')
  }
  return {
    appName: 'Communal Cache',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [env.APP_BASE_URL],
    // Provider exceptions can contain credentials; never log their raw payloads.
    logger: { disabled: true },
    socialProviders: googleConfigured(env) ? {
      google: {
        clientId: env.GOOGLE_CLIENT_ID!,
        clientSecret: env.GOOGLE_CLIENT_SECRET!,
        mapProfileToUser: () => ({ name: '', image: undefined }),
      },
    } : {},
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google'],
        requireLocalEmailVerified: true,
        allowDifferentEmails: false,
        updateUserInfoOnLink: false,
      },
      storeStateStrategy: 'database',
      skipStateCookieCheck: false,
      storeAccountCookie: false,
    },
    databaseHooks: { account: { create: { before: discardOAuthTokens }, update: { before: discardOAuthTokens } } },
    onAPIError: {
      errorURL: env.APP_BASE_URL + '/login',
      onError(error) {
        // ponytail: 1.7.7 restores a wrong OTP after consuming it; a newer resend
        // wins our partial unique index. PR #10443 will classify this as INVALID_OTP upstream.
        if (
          requestPath === '/api/auth/sign-in/email-otp' && error instanceof Error &&
          /^D1_ERROR: UNIQUE constraint failed: verification\.identifier: SQLITE_CONSTRAINT(?: \(extended: SQLITE_CONSTRAINT_UNIQUE\))?$/.test(error.message)
        ) {
          throw new APIError('BAD_REQUEST', { code: 'INVALID_OTP', message: 'Invalid OTP' })
        }
      },
    },
    emailAndPassword: { enabled: false },
    user: {
      validateUserInfo({ user, source }) {
        // trustedProviders alone bypasses the provider verification check in 1.7.7.
        if (source.method === 'oauth' && (source.oauth?.providerId !== 'google' || user.emailVerified !== true || source.oauth.profile?.email_verified !== true)) {
          return { error: 'email_not_verified' }
        }
      },
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
      useSecureCookies: appUrl.protocol === 'https:',
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
        await sendAuthMail(env,requestUrl,{
          to: [email],
          subject: 'Your Communal Cache sign-in code',
          text: `Your sign-in code is ${otp}. It expires in 5 minutes. Use the most recent code you requested, even if an older email arrives later.`,
        })
        if (delivery) delivery.status = 'sent'
      },
    }), magicLink({
      expiresIn: 300,
      storeToken: 'hashed',
      disableSignUp: false,
      rateLimit: { window: 60, max: 5 },
      async sendMagicLink({ email, url, token }) {
        const link = magicLandingUrl(env.APP_BASE_URL, token, url)
        if (delivery) delivery.status = 'failed'
        await sendAuthMail(env,requestUrl,{
            to: [email],
            subject: 'Your Communal Cache sign-in link',
            text: `Sign in to Communal Cache:\n${link}\n\nThis link expires in 5 minutes. Use the newest link if you requested another. Open it, then press Continue to sign in.`,
            html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background-color:#f8fafc;color:#0f172a;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;border:1px solid #e2e8f0;border-radius:16px;background-color:#ffffff;"><tr><td align="center" style="padding:32px 24px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td width="56" height="56" align="center" bgcolor="#0f172a" style="border-radius:16px;color:#ffffff;font-size:18px;font-weight:700;">CC</td></tr></table>
<h1 style="margin:20px 0 8px;font-size:22px;line-height:28px;font-weight:700;">Sign in to Communal Cache</h1>
<p style="margin:0;color:#475569;font-size:16px;line-height:24px;">Tap the button, then press Continue.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto;"><tr><td align="center" bgcolor="#0f172a" style="border-radius:12px;mso-padding-alt:14px 48px;"><a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 48px;border-radius:12px;color:#ffffff;text-decoration:none;font-size:16px;line-height:24px;font-weight:700;">Sign in</a></td></tr></table>
<p style="margin:0;color:#475569;font-size:14px;line-height:21px;">This link works once and expires in 5 minutes. If you asked for more than one, use the newest email.</p>
<p style="margin:16px 0 0;color:#475569;font-size:14px;line-height:21px;">Didn't ask for this? You can ignore it.</p>
</td></tr></table></td></tr></table></body></html>`,
        })
        if (delivery) delivery.status = 'sent'
      },
    })],
  } satisfies BetterAuthOptions
}

export function createAuth(env: AuthEnv, delivery?: DeliveryResult, requestPath?: string, requestUrl?: string) {
  return betterAuth(authOptions(env, delivery, requestPath, requestUrl))
}
