const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/i

export function validJoinToken(token: string) { return token.length === 80 && TOKEN.test(token) }

export function isInvitePath(path: string) {
  try { return /^\/join(?:\/|[?#]|$)/i.test(decodeURIComponent(path)) }
  catch { return false }
}

export function inviteDestination(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/join/')) return null
  return validJoinToken(value.slice(6)) ? value : null
}
