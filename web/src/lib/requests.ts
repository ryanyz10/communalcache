import type { QueryClient } from '@tanstack/react-query'

export type ItemRequest = {
  id: string; cache_id: string; cache_name: string; item_id: string; item_title: string
  owner_id: string; owner_name: string | null; requester_id: string; requester_name: string | null
  quantity: number | null; status: 'pending' | 'approved' | 'rejected'; decision_reason: string | null
  created_at: number; decided_at: number | null
}
export type RequestsPageData = { requests: ItemRequest[]; unavailable_cache_ids: string[]; next_cursor: string | null }

export function invalidateRequestViews(client: QueryClient, cacheId: string, itemId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['item-requests', cacheId, itemId] }),
    client.invalidateQueries({ queryKey: ['requests'] }),
    client.invalidateQueries({ queryKey: ['item', cacheId, itemId] }),
    client.invalidateQueries({ queryKey: ['items', cacheId] }),
  ])
}
