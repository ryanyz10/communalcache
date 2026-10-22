import { useQuery, type QueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'
import type { CatCoat } from './cats'
import type { Item } from './items'

export type CacheMember = { user_id: string; display_name: string | null; cat_coat?: CatCoat | null; profile_photo_version?: string | null }
export type CacheSummary = {
  id: string; name: string; owner_id: string; requires_approval: boolean
  active_member_count: number; attached_item_count: number; pending_answer_count: number; member_preview: CacheMember[]
}
export type CacheInfo = { id: string; name: string; owner_id: string; invite_token: string; requires_approval: boolean }
export type CacheDetail = CacheInfo & { members: (CacheMember & { attached_item_count: number })[] }
export type AskPreview = {
  id: string; cache_id: string; item_id: string; item_title: string; user_id: string; display_name: string | null
  cat_coat: CatCoat | null; profile_photo_version: string | null; created_at: number
}
export type HomeSummary = {
  owned_item_count: number; pending_answer_count: number
  incoming: (AskPreview & { quantity: number | null })[]
  outgoing: (AskPreview & { status: 'pending' | 'approved' | 'rejected' })[]
}
export const cacheKeys = {
  list: () => ['caches'],
  detailPrefix: () => ['cache'],
  detail: (cacheId: string | undefined) => ['cache', cacheId],
  contentsPrefix: () => ['items'],
  contents: (cacheId: string) => ['items', cacheId],
  summary: () => ['home-summary'],
}

// Home prefetch and cache-context pages share the same cache entries.
export const cacheListQuery = () => ({ queryKey: cacheKeys.list(), queryFn: () => apiFetch<CacheSummary[]>('/api/caches') })
export const cacheDetailQuery = (cacheId: string | undefined) => ({ queryKey: cacheKeys.detail(cacheId), queryFn: () => apiFetch<CacheDetail>(`/api/caches/${cacheId}`) })
export const cacheItemsQuery = (cacheId: string) => ({ queryKey: cacheKeys.contents(cacheId), queryFn: () => apiFetch<(Item & { pending_count: number })[]>(`/api/caches/${cacheId}/items`) })
export const homeSummaryQuery = () => ({ queryKey: cacheKeys.summary(), queryFn: () => apiFetch<HomeSummary>('/api/me/summary') })
export function useHomeSummary(enabled: boolean) {
  return useQuery({ ...homeSummaryQuery(), enabled })
}

export function invalidateCacheViews(client: QueryClient, cacheId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: cacheKeys.detail(cacheId) }),
    client.invalidateQueries({ queryKey: cacheKeys.list() }),
  ])
}
export function askedWhen(createdAt: number, now = Date.now()) {
  const days = Math.floor((now-createdAt)/86_400_000)
  return days < 1 ? 'Asked today' : days === 1 ? 'Asked yesterday' : `Asked ${days} days ago`
}
export function startSlowNotice(reveal: () => void) {
  const timer = setTimeout(reveal, 6000)
  return () => clearTimeout(timer)
}

export function greeting(hour: number) { return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening' }
export function incomingDescription(ask: HomeSummary['incoming'][number]) {
  const name=ask.display_name ?? 'A neighbor'
  return ask.quantity === null ? `${name} wants to borrow your ${ask.item_title}.` : `${name} asked for ${ask.quantity} ${ask.item_title}.`
}
export type ContentsFilter = 'all' | 'lend' | 'give'
export function filterContents<T extends Item>(items: T[], filter: ContentsFilter, search: string) {
  const needle=search.trim().toLocaleLowerCase()
  return items.filter(item => (filter === 'all' || item.is_consumable === (filter === 'give'))
    && (!needle || `${item.title} ${item.description ?? ''} ${item.owner_name ?? ''}`.toLocaleLowerCase().includes(needle)))
}
