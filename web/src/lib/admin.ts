import { apiFetch } from './api'

export type AdminPlan = { plan: 'free' | 'plus' }
export type AdminOverview = {
  users: number; caches: number; items: number; pending_requests: number
  outbox_pending: number; outbox_failed: number; outbox_oldest_age_ms: number | null; plans: AdminPlan[]
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

export function adminListPath(kind: 'caches' | 'users' | 'failed-outbox', after: string | null) {
  return `/api/admin/${kind}` + (after ? `?after=${encodeURIComponent(after)}` : '')
}

export function setAdminPlan(kind: 'caches' | 'users', id: string, plan: string) {
  return apiFetch(`/api/admin/${kind}/${encodeURIComponent(id)}/plan`, { method: 'PATCH', body: { plan } })
}
