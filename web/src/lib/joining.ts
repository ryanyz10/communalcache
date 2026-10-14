import { apiFetch } from './api'
import { clearJoinToken, validJoinToken } from './pendingJoin'

export type JoinResult = { cache_id: string; name: string; status: 'active' | 'pending' }
export type JoinRequest = { user_id: string; display_name: string | null; created_at: number }

export async function joinFromToken(token: string) {
  if (!validJoinToken(token)) throw new Error('Invalid invite link')
  const [cacheId, secret] = token.split('.')
  const result = await apiFetch<JoinResult>(`/api/caches/${cacheId}/join`, { body: { secret } })
  clearJoinToken()
  return result
}
