import { apiFetch } from './api'

export type AdminPlan = { plan: 'free' | 'plus' }
export type AdminFlag = { key: 'google_sign_in'; enabled: boolean; updated_at: number }
export type AdminOverview = {
  users: number; caches: number; items: number; pending_requests: number
  outbox_pending: number; outbox_failed: number; outbox_oldest_age_ms: number | null
  cleanup_pending: number; cleanup_oldest_age_ms: number | null; plans: AdminPlan[]
}
export type AdminPageRows<T> = { rows: T[]; next_cursor: string | null }
export type AdminCache = {
  id: string; name: string; owner_id: string | null; owner_name: string | null; plan: string
  member_count: number; member_limit: number | null; item_count: number
}
export type AdminUser = {
  id: string; display_name: string | null; plan: string
  owned_caches: number; owned_cache_limit: number | null; owned_items: number; owned_item_limit: number | null
  pending_outgoing: number; pending_limit: number | null; memberships: number; membership_limit: number | null
  new_caches_24h: number; new_cache_limit: number | null; profile_photos: number; profile_photo_limit: number | null
}
export type AdminOutbox = { id: string; kind: string; created_at: number; failed_at: number; attempts: number; error_class: string | null }

export const adminKeys = {
  all: (userId: string | undefined) => ['admin', userId],
  overview: (userId: string | undefined) => ['admin', userId, 'overview'],
  list: (userId: string | undefined, kind: 'caches' | 'users' | 'failed-outbox', after: string | null) => ['admin', userId, kind, after],
  flags: (userId: string | undefined) => ['admin', userId, 'flags'],
}
export const adminOverviewQuery = (userId: string | undefined) => ({ queryKey: adminKeys.overview(userId), queryFn: () => apiFetch<AdminOverview>('/api/admin/overview') })
export const adminCachesQuery = (userId: string | undefined, after: string | null) => ({ queryKey: adminKeys.list(userId, 'caches', after), queryFn: () => apiFetch<AdminPageRows<AdminCache>>(adminListPath('caches', after)) })
export const adminUsersQuery = (userId: string | undefined, after: string | null) => ({ queryKey: adminKeys.list(userId, 'users', after), queryFn: () => apiFetch<AdminPageRows<AdminUser>>(adminListPath('users', after)) })
export const adminOutboxQuery = (userId: string | undefined, after: string | null) => ({ queryKey: adminKeys.list(userId, 'failed-outbox', after), queryFn: () => apiFetch<AdminPageRows<AdminOutbox>>(adminListPath('failed-outbox', after)) })
export const adminFlagsQuery = (userId: string | undefined) => ({ queryKey: adminKeys.flags(userId), queryFn: () => apiFetch<{ flags: AdminFlag[] }>('/api/admin/flags') })

export function adminListPath(kind: 'caches' | 'users' | 'failed-outbox', after: string | null) {
  return `/api/admin/${kind}` + (after ? `?after=${encodeURIComponent(after)}` : '')
}

export function setAdminFlag(key: AdminFlag['key'], enabled: boolean) {
  return apiFetch(`/api/admin/flags/${key}`, { method: 'PATCH', body: { enabled } })
}

export function setAdminPlan(kind: 'caches' | 'users', id: string, plan: string) {
  return apiFetch(`/api/admin/${kind}/${encodeURIComponent(id)}/plan`, { method: 'PATCH', body: { plan } })
}
