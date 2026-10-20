import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/react-query'
import { apiFetch } from './api'
import type { CatCoat } from './cats'
import { uploadPhoto } from './photos'

export type Item = {
  id: string
  cache_id: string | null
  owner_id: string
  owner_name: string | null
  owner_photo_version?: string | null
  owner_cat_coat?: CatCoat | null
  title: string
  description: string | null
  is_consumable: boolean
  quantity: number | null
  available_quantity?: number | null
  available?: boolean
  active?: boolean
  created_at: number
  photo_version: string | null
}

export type LibraryItem = Item & { caches: { id: string; name: string }[]; pending_count: number }
export const libraryItemQuery = (userId: string | undefined, itemId: string) => ({ queryKey: ['library-item', userId, itemId], queryFn: () => apiFetch<LibraryItem>(`/api/me/items/${itemId}`) })
export type LibraryFilter = 'all' | 'lend' | 'give' | 'unshared'
export type LibraryTotals = {total_count:number;lend_count:number;give_count:number;unshared_count:number;shared_cache_count:number}
export type LibraryPageData = { items: LibraryItem[]; next_cursor: string | null; totals: LibraryTotals }

export function libraryQuery(userId: string | undefined) {
  return infiniteQueryOptions({
    queryKey: ['library', userId], initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const first = await apiFetch<LibraryPageData>(`/api/me/items${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ''}`, { signal })
      signal.throwIfAborted()
      const result = { ...first, items: [...first.items] }
      // ponytail: eager loading stops at 20 API pages; larger libraries need larger pages or server filters.
      const pageLimit = pageParam ? 1 : 20
      for (let page = 1; result.next_cursor && page < pageLimit; page++) {
        const next = await apiFetch<LibraryPageData>(`/api/me/items?after=${encodeURIComponent(result.next_cursor)}`, { signal })
        signal.throwIfAborted()
        result.items.push(...next.items)
        result.next_cursor = next.next_cursor
      }
      return result
    },
    getNextPageParam: page => page.next_cursor ?? undefined, enabled: !!userId,
  })
}

export function useLibrary(userId: string | undefined) {
  return useInfiniteQuery(libraryQuery(userId))
}

export function filterLibraryItems(items: LibraryItem[], filter: LibraryFilter) {
  return items.filter(item => filter === 'all' || (filter === 'lend' && !item.is_consumable)
    || (filter === 'give' && item.is_consumable) || (filter === 'unshared' && !item.caches.length))
}

export function sharingHint(item: LibraryItem, cacheId?: string) {
  if (cacheId && item.caches.some(cache => cache.id === cacheId)) return 'Already here'
  const names = item.caches.map(cache => cache.name).join(', ')
  return names ? `${cacheId ? 'In ' : ''}${names}` : cacheId ? 'Not shared yet' : 'Not in a cache yet'
}

export type ItemSaveProgress = {
  item: Item | null; remainingCacheIds: string[]; remainingDetachIds: string[]; failedCacheId: string | null
  photoPending: boolean; stage: 'saving' | 'photo' | 'sharing' | 'done'
}

export async function persistItem(progress: ItemSaveProgress, input: {
  cacheId:string|null;itemId?:string;body:unknown;cacheIds:string[];initialCacheIds?:string[];photo:Blob|null
}, changed: () => void, attachmentChanged?: (cacheId: string, shared: boolean) => void) {
  progress.failedCacheId = null
  if (!progress.item) {
    progress.item = await apiFetch<Item>(`${input.cacheId ? `/api/caches/${input.cacheId}/items` : '/api/me/items'}${input.itemId ? `/${input.itemId}` : ''}`, {
      method:input.itemId?'PATCH':'POST',body:input.body,
    })
    const initialIds = input.initialCacheIds ?? []
    progress.remainingCacheIds = input.cacheIds.filter(id => input.itemId ? !initialIds.includes(id) : id !== input.cacheId)
    // Keep the current route usable until every other cache change has succeeded.
    progress.remainingDetachIds = input.itemId ? initialIds.filter(id => !input.cacheIds.includes(id))
      .sort((a,b) => Number(a === input.cacheId) - Number(b === input.cacheId)) : []
    progress.photoPending = !!input.photo
    changed()
  }
  if (progress.photoPending && input.photo) {
    progress.stage='photo'; changed()
    progress.item=await uploadPhoto(null,progress.item.id,input.photo)
    progress.photoPending=false; changed()
  }
  progress.stage='sharing'; changed()
  const operations = [...progress.remainingCacheIds.map(cacheId => ({cacheId,shared:true})), ...progress.remainingDetachIds.map(cacheId => ({cacheId,shared:false}))]
  for (const {cacheId,shared} of operations) {
    try {
      await apiFetch(`/api/me/items/${progress.item.id}/attachments/${cacheId}`,{method:shared?'PUT':'DELETE'})
    } catch (error) {
      progress.failedCacheId=cacheId; changed()
      throw error
    }
    if (shared) progress.remainingCacheIds=progress.remainingCacheIds.filter(id=>id!==cacheId)
    else progress.remainingDetachIds=progress.remainingDetachIds.filter(id=>id!==cacheId)
    attachmentChanged?.(cacheId,shared)
    changed()
  }
  progress.stage='done'; changed()
  return progress.item
}

export async function attachSelected(itemIds: string[], cacheId: string, attached: (id: string) => void) {
  // Keep successes when a later attach fails; retry only the remaining selection.
  for (const id of itemIds) {
    await apiFetch(`/api/me/items/${id}/attachments/${cacheId}`, { method: 'PUT' })
    attached(id)
  }
}
