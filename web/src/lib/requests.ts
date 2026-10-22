import { infiniteQueryOptions, useInfiniteQuery, type QueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'
import type { CatCoat } from './cats'
import { cacheKeys } from './caches'
import { itemKeys } from './items'
import { contactKeys } from './contacts'

export type ItemRequest = {
  id: string; cache_id: string; cache_name: string; item_id: string; item_title: string
  owner_id: string; owner_name: string | null; requester_id: string; requester_name: string | null
  owner_photo_version?: string | null; requester_photo_version?: string | null
  owner_cat_coat?: CatCoat | null; requester_cat_coat?: CatCoat | null
  quantity: number | null; status: 'pending' | 'approved' | 'rejected'; decision_reason: string | null
  created_at: number; decided_at: number | null; approval_message?: string | null; queue_position?: number | null
}
export const DEFAULT_MARK_LENT_OUT = true

export function approvalBody(quantity:number|null,message:string,markLentOut:boolean) {
  return {approval_message:message.trim(),mark_lent_out:quantity===null && markLentOut}
}
export function relativeWhen(time:number,now=Date.now()) {
  const minutes=Math.max(0,Math.floor((now-time)/60_000)),hours=Math.floor(minutes/60),days=Math.floor(hours/24)
  if(minutes<1)return 'just now'
  if(hours<1)return `${minutes} ${minutes===1?'minute':'minutes'} ago`
  if(days<1)return `${hours} ${hours===1?'hour':'hours'} ago`
  if(days===1)return 'yesterday'
  if(days<7)return `${days} days ago`
  if(days<14)return 'last week'
  return `${Math.floor(days/7)} weeks ago`
}
export function stockAfterApproval(quantity:number,asked:number) { return quantity-asked }

export type RequestsPageData = { requests: ItemRequest[]; unavailable_cache_ids: string[]; next_cursor: string | null }

export function ordinal(position: number) {
  const lastTwo = position % 100
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[position % 10] ?? 'th'
  return `${position}${suffix}`
}

export function requesterQueueLabel(request: ItemRequest, callerId: string) {
  if (request.requester_id !== callerId || request.status !== 'pending' || request.quantity !== null || !request.queue_position) return null
  return request.queue_position === 1 ? "You're next" : `You're ${ordinal(request.queue_position)} in line`
}

export const requestKeys = {
  list: (view?: 'incoming', itemId?: string) => view ? itemId ? ['requests', view, itemId] : ['requests', view] : ['requests'],
  itemPrefix: () => ['item-requests'],
  item: (cacheId: string | null, itemId: string) => ['item-requests', cacheId, itemId],
  detailPrefix: () => ['request-detail'],
  detail: (userId: string, requestId: string) => ['request-detail', userId, requestId],
}
export const itemRequestsQuery = (cacheId: string | null, itemId: string) => ({ queryKey: requestKeys.item(cacheId, itemId), queryFn: () => apiFetch<ItemRequest[]>(`/api/caches/${cacheId}/items/${itemId}/requests`) })
export const requestDetailQuery = (userId: string, requestId: string) => ({ queryKey: requestKeys.detail(userId, requestId), queryFn: () => apiFetch<ItemRequest>(`/api/me/requests/${requestId}`) })

export function requestsQuery(view?: 'incoming', itemId?: string) {
  return infiniteQueryOptions({
    queryKey: requestKeys.list(view, itemId), initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (view) params.set('view', view)
      if (itemId) params.set('item_id', itemId)
      if (pageParam) params.set('after', pageParam)
      return apiFetch<RequestsPageData>(`/api/requests${params.size ? `?${params}` : ''}`)
    },
    getNextPageParam: page => page.next_cursor ?? undefined,
  })
}

export function useRequests(enabled: boolean, view?: 'incoming', itemId?: string) {
  return useInfiniteQuery({ ...requestsQuery(view, itemId), enabled })
}

export function invalidateRequestViews(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: requestKeys.itemPrefix() }),
    client.invalidateQueries({ queryKey: requestKeys.list() }),
    client.invalidateQueries({ queryKey: itemKeys.detailPrefix() }),
    client.invalidateQueries({ queryKey: cacheKeys.contentsPrefix() }),
    client.invalidateQueries({ queryKey: itemKeys.libraryPrefix() }),
    client.invalidateQueries({ queryKey: itemKeys.libraryItemPrefix() }),
    client.invalidateQueries({ queryKey: cacheKeys.summary() }),
    client.invalidateQueries({ queryKey: cacheKeys.list() }),
    client.invalidateQueries({ queryKey: cacheKeys.detailPrefix() }),
    client.invalidateQueries({ queryKey: requestKeys.detailPrefix() }),
    client.invalidateQueries({ queryKey: contactKeys.requestPrefix() }),
  ])
}
