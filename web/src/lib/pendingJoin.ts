const JOIN_KEY = 'cc_pending_join'
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/i

export function validJoinToken(token: string) { return TOKEN.test(token) }

export function stashJoinToken(token: string) {
  if (!validJoinToken(token)) throw new Error('Invalid invite link')
  sessionStorage.setItem(JOIN_KEY, token)
}

export function peekJoinToken(): string | null {
  const token = sessionStorage.getItem(JOIN_KEY)
  return token && validJoinToken(token) ? token : null
}

export function clearJoinToken() { sessionStorage.removeItem(JOIN_KEY) }

export function destinationAfterLogin() {
  const token = peekJoinToken()
  return token ? `/join/${token}` : '/'
}
