import { apiFetch } from './api'
import { isInvitePath } from '../../../shared/invites'
import { destinationAfterLogin, peekJoinToken, stashJoinToken } from './pendingJoin'

export function sendSignInEmail(email: string, mode: 'link' | 'code', inviteToken: string | undefined, turnstileToken: string) {
  if (inviteToken) stashJoinToken(inviteToken)
  const token = peekJoinToken()
  return mode === 'link' ? apiFetch('/api/auth/sign-in/magic-link', { body: { email: email.trim(), ...(token ? {callbackURL:`/join/${token}`} : {}) }, turnstileToken })
    : apiFetch('/api/auth/email-otp/send-verification-otp', { body: { email: email.trim(), type: 'sign-in' }, turnstileToken })
}

export function magicLinkDestination(callbackUrl: string, origin: string) {
  let path = '/'
  try {
    const callback = new URL(callbackUrl,origin)
    if (callback.origin === origin && !callback.username && !callback.password) path = callback.pathname + callback.search + callback.hash
  } catch { /* A malformed callback cannot navigate outside the app. */ }
  const destination = destinationAfterLogin(path)
  if (destination !== '/') return destination
  return isInvitePath(path) ? '/' : path
}

export function readMagicLink(hash: string) {
  if (hash.length > 24_576) return null
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const token = params.get('token')
  if (!token || !/^[A-Za-z]{32}$/.test(token)) return null
  return {
    token,
    callbackURL: params.get('callbackURL') ?? '/',
    newUserCallbackURL: params.get('newUserCallbackURL') ?? params.get('callbackURL') ?? '/',
    errorCallbackURL: params.get('errorCallbackURL') ?? params.get('callbackURL') ?? '/',
  }
}

export function verifyMagicLink(link: NonNullable<ReturnType<typeof readMagicLink>>) {
  return apiFetch<{ success: boolean; callback_url: string }>('/api/auth/magic-link/verify', { body: link })
}
