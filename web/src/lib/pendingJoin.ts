import { inviteDestination, validJoinToken } from '../../../shared/invites'
export { validJoinToken } from '../../../shared/invites'

const JOIN_KEY = 'cc_pending_join'
export const PENDING_JOIN_TTL_MS = 60 * 60 * 1000
const stores = ['sessionStorage','localStorage'] as const

function storedToken(storage: Storage): string | null {
  const raw = storage.getItem(JOIN_KEY)
  if (!raw) return null
  try {
    const record = JSON.parse(raw)
    const now = Date.now()
    if (record && typeof record.token === 'string' && validJoinToken(record.token) && Number.isSafeInteger(record.expiresAt) && record.expiresAt > now && record.expiresAt <= now + PENDING_JOIN_TTL_MS) return record.token
  } catch { /* Discard malformed/legacy records rather than retaining an unbounded token. */ }
  storage.removeItem(JOIN_KEY)
  return null
}

export function stashJoinToken(token: string) {
  if (!validJoinToken(token)) throw new Error('Invalid invite link')
  const record = JSON.stringify({token,expiresAt:Date.now()+PENDING_JOIN_TTL_MS})
  let saved = false
  for (const name of stores) {
    try { globalThis[name].setItem(JOIN_KEY,record); saved = true } catch { /* Either store can be unavailable. */ }
  }
  if (!saved) throw new Error('Could not save invite')
}

export function peekJoinToken(): string | null {
  let token: string | null = null
  for (const name of stores) {
    try { const stored = storedToken(globalThis[name]); token ??= stored } catch { /* Try the other store. */ }
  }
  return token
}

export function clearJoinToken(expectedToken?: string) {
  for (const name of stores) {
    try {
      const storage = globalThis[name]
      if (expectedToken === undefined || storedToken(storage) === expectedToken) storage.removeItem(JOIN_KEY)
    } catch { /* Storage can be disabled; sign-out must still finish. */ }
  }
}

export function destinationAfterLogin(callback?: unknown) {
  const explicit = inviteDestination(callback)
  if (explicit) return explicit
  const token = peekJoinToken()
  return token ? `/join/${token}` : '/'
}

export function parseInvite(input: string): string | null {
  if (input.length > 2048) return null
  const value = input.trim().replace(/\/$/,'')
  if (/[\x00-\x1f\x7f\\]/.test(value)) return null
  if (validJoinToken(value)) return value
  const path = inviteDestination(value)
  if (path) return path.slice(6)
  if (!/^https?:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash) return null
    return inviteDestination(url.pathname)?.slice(6) ?? null
  } catch { return null }
}
