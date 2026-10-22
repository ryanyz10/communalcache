import { apiFetch } from './api'
import type { CatCoat, CatTraits } from './cats'
import { clearJoinToken, validJoinToken } from './pendingJoin'

export type InvitePreview = { name: string; active_member_count: number; members: CatTraits[] }
export type JoinResult = { cache_id: string; name: string; status: 'active' | 'pending' }

export const joiningKeys = {
  preview: (userId: string | undefined, token: string) => ['invite-preview', userId, token],
  requestsPrefix: () => ['join-requests'],
  requests: (cacheId: string) => ['join-requests', cacheId],
}
export const invitePreviewQuery = (userId: string | undefined, token: string) => ({ queryKey: joiningKeys.preview(userId, token), queryFn: () => previewFromToken(token) })
export const joinRequestsQuery = (cacheId: string) => ({ queryKey: joiningKeys.requests(cacheId), queryFn: () => apiFetch<JoinRequest[]>(`/api/caches/${cacheId}/join-requests`) })

export function previewFromToken(token: string) {
  if (!validJoinToken(token)) throw new Error('Invalid invite link')
  const [cacheId, secret] = token.split('.')
  return apiFetch<InvitePreview>(`/api/caches/${cacheId}/invite/preview`, { headers: { 'X-Invite-Secret': secret } })
}
export type JoinRequest = { user_id: string; display_name: string | null; created_at: number; cat_coat?: CatCoat | null; profile_photo_version?: string | null }

export async function joinFromToken(token: string) {
  if (!validJoinToken(token)) throw new Error('Invalid invite link')
  const [cacheId, secret] = token.split('.')
  const result = await apiFetch<JoinResult>(`/api/caches/${cacheId}/join`, { body: { secret } })
  clearJoinToken(token)
  return result
}
