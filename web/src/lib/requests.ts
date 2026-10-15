import { useInfiniteQuery, type QueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'

export type ItemRequest = {
  id: string; cache_id: string; cache_name: string; item_id: string; item_title: string
  owner_id: string; owner_name: string | null; requester_id: string; requester_name: string | null
  quantity: number | null; status: 'pending' | 'approved' | 'rejected'; decision_reason: string | null
  created_at: number; decided_at: number | null
}
export type RequestsPageData = { requests: ItemRequest[]; unavailable_cache_ids: string[]; next_cursor: string | null }

export function useRequests(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['requests'], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiFetch<RequestsPageData>(`/api/requests${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: page => page.next_cursor ?? undefined, enabled,
  })
}

export function pendingIncomingCount(rows: ItemRequest[], userId: string) {
  return rows.filter(row => row.owner_id === userId && row.status === 'pending').length
}

export function invalidateRequestViews(client: QueryClient, cacheId: string, itemId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['item-requests', cacheId, itemId] }),
    client.invalidateQueries({ queryKey: ['requests'] }),
    client.invalidateQueries({ queryKey: ['item', cacheId, itemId] }),
    client.invalidateQueries({ queryKey: ['items', cacheId] }),
    client.invalidateQueries({ queryKey: ['my-items'] }),
  ])
}
