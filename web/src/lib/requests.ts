import { useInfiniteQuery, type QueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'
import type { CatCoat } from './cats'

export type ItemRequest = {
  id: string; cache_id: string; cache_name: string; item_id: string; item_title: string
  owner_id: string; owner_name: string | null; requester_id: string; requester_name: string | null
  owner_photo_version?: string | null; requester_photo_version?: string | null
  owner_cat_coat?: CatCoat | null; requester_cat_coat?: CatCoat | null
  quantity: number | null; status: 'pending' | 'approved' | 'rejected'; decision_reason: string | null
  created_at: number; decided_at: number | null; approval_message?: string | null; queue_position?: number | null
}
export const DEFAULT_MARK_LENT_OUT = true

export function approvalBody(quantity:number|null,message:string,markLentOut:boolean,note:string,noteEdited:boolean) {
  const mark=quantity===null && markLentOut
  return {approval_message:message.trim(),mark_lent_out:mark,...(mark && noteEdited?{unavailable_note:note.trim() || null}:{})}
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

export function useRequests(enabled: boolean, view?: 'incoming') {
  return useInfiniteQuery({
    queryKey: view ? ['requests', view] : ['requests'], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (view) params.set('view', view)
      if (pageParam) params.set('after', pageParam)
      return apiFetch<RequestsPageData>(`/api/requests${params.size ? `?${params}` : ''}`)
    },
    getNextPageParam: page => page.next_cursor ?? undefined, enabled,
  })
}

export function invalidateRequestViews(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['item-requests'] }),
    client.invalidateQueries({ queryKey: ['requests'] }),
    client.invalidateQueries({ queryKey: ['item'] }),
    client.invalidateQueries({ queryKey: ['items'] }),
    client.invalidateQueries({ queryKey: ['library'] }),
    client.invalidateQueries({ queryKey: ['library-item'] }),
    client.invalidateQueries({ queryKey: ['home-summary'] }),
    client.invalidateQueries({ queryKey: ['caches'] }),
    client.invalidateQueries({ queryKey: ['cache'] }),
    client.invalidateQueries({ queryKey: ['request-detail'] }),
    client.invalidateQueries({ queryKey: ['request-contact'] }),
  ])
}
