const JOIN_TOKEN_KEY = 'cc_join_token'

export function stashJoinToken(token: string) {
  sessionStorage.setItem(JOIN_TOKEN_KEY, token)
}

export function peekJoinToken(): string | null {
  return sessionStorage.getItem(JOIN_TOKEN_KEY)
}

export function clearJoinToken() {
  sessionStorage.removeItem(JOIN_TOKEN_KEY)
}
