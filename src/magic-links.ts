import { HttpError } from './http'
import { inviteDestination, isInvitePath } from '../shared/invites'

const callbackFields = ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL'] as const

export function magicCallbacks(body: Record<string, unknown>, origin: string, generated = false) {
  const callbacks = {
    callbackURL: origin + '/', newUserCallbackURL: origin + '/', errorCallbackURL: origin + '/',
  }
  for (const field of callbackFields) {
    const value = body[field]
    if (value === undefined) continue
    if (typeof value !== 'string' || !value || value.length > 2048 || value.startsWith('//') || /[\s\\]/.test(value)) {
      throw new HttpError(400, 'invalid_callback')
    }
    let url: URL
    try { url = new URL(value, origin) }
    catch { throw new HttpError(400, 'invalid_callback') }
    if (url.origin !== origin || url.username || url.password || url.href.length > 2048) throw new HttpError(400, 'invalid_callback')
    if (isInvitePath(url.pathname) && !inviteDestination(generated ? url.pathname + url.search + url.hash : value)) {
      throw new HttpError(400, 'invalid_callback')
    }
    callbacks[field] = url.href
  }
  if (body.newUserCallbackURL === undefined) callbacks.newUserCallbackURL = callbacks.callbackURL
  if (body.errorCallbackURL === undefined) callbacks.errorCallbackURL = callbacks.callbackURL
  return callbacks
}

export function magicLandingUrl(origin: string, token: string, verificationUrl: string) {
  // Better Auth expands our validated relative callbacks to absolute URLs.
  const callbacks = magicCallbacks(Object.fromEntries(new URL(verificationUrl).searchParams), origin, true)
  for (const field of callbackFields) {
    const url = new URL(callbacks[field])
    callbacks[field] = inviteDestination(url.pathname + url.search + url.hash) ?? callbacks[field]
  }
  const landing = new URL('/auth/link', origin)
  landing.hash = new URLSearchParams({ token, ...callbacks }).toString()
  return landing.href
}
