import { apiFetch } from './api'
import { destinationAfterLogin, stashJoinToken } from './pendingJoin'

export const googleSignInError = 'Google sign-in didn’t finish. Try again, or use an email link or code.'

export async function googleSignInUrl(inviteToken?: string) {
  if (inviteToken) stashJoinToken(inviteToken)
  const callbackURL = destinationAfterLogin()
  const errorCallbackURL = callbackURL === '/' ? '/login' : callbackURL
  const result = await apiFetch<{ url: string }>('/api/auth/sign-in/social', {
    body: { provider: 'google', callbackURL, errorCallbackURL },
  })
  const url = new URL(result.url)
  if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password) {
    throw new Error(googleSignInError)
  }
  return url.href
}
