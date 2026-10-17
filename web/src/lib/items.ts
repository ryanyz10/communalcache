import { useInfiniteQuery } from '@tanstack/react-query'
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
  unavailable_note?: string | null
  created_at: number
  photo_version: string | null
}

export type LibraryItem = Item & { caches: { id: string; name: string }[]; pending_count: number }
export const libraryItemQuery = (userId: string | undefined, itemId: string) => ({ queryKey: ['library-item', userId, itemId], queryFn: () => apiFetch<LibraryItem>(`/api/me/items/${itemId}`) })
export type LibraryFilter = 'all' | 'lend' | 'give' | 'unshared'
export type LibraryTotals = {total_count:number;lend_count:number;give_count:number;unshared_count:number;shared_cache_count:number}
export type LibraryPageData = { items: LibraryItem[]; next_cursor: string | null; totals: LibraryTotals }

export function useLibrary(userId: string | undefined, filter: LibraryFilter = 'all') {
  return useInfiniteQuery({
    queryKey: filter==='all' ? ['library',userId] : ['library',userId,filter], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const search=new URLSearchParams()
      if(pageParam) search.set('after',pageParam)
      if(filter!=='all') search.set('filter',filter)
      return apiFetch<LibraryPageData>(`/api/me/items${search.size?`?${search}`:''}`)
    },
    getNextPageParam: page => page.next_cursor ?? undefined, enabled: !!userId,
  })
}

export function sharingHint(item: LibraryItem, cacheId?: string) {
  if (cacheId && item.caches.some(cache => cache.id === cacheId)) return 'Already here'
  const names = item.caches.map(cache => cache.name).join(', ')
  return names ? `${cacheId ? 'In ' : ''}${names}` : cacheId ? 'Not shared yet' : 'Not in a cache yet'
}

export type ItemSaveProgress = { item: Item | null; remainingCacheIds: string[]; photoPending: boolean; stage: 'saving' | 'photo' | 'sharing' | 'done' }

export async function persistItem(progress: ItemSaveProgress, input: {cacheId:string|null;itemId?:string;body:unknown;cacheIds:string[];photo:Blob|null}, changed: () => void) {
  if (!progress.item) {
    progress.item = await apiFetch<Item>(`${input.cacheId ? `/api/caches/${input.cacheId}/items` : '/api/me/items'}${input.itemId ? `/${input.itemId}` : ''}`, {
      method:input.itemId?'PATCH':'POST',body:input.body,
    })
    progress.remainingCacheIds = input.cacheIds.filter(id=>id!==input.cacheId)
    progress.photoPending = !!input.photo
    changed()
  }
  if (progress.photoPending && input.photo) {
    progress.stage='photo'; changed()
    progress.item=await uploadPhoto(null,progress.item.id,input.photo)
    progress.photoPending=false; changed()
  }
  progress.stage='sharing'; changed()
  for (const cacheId of [...progress.remainingCacheIds]) {
    await apiFetch(`/api/me/items/${progress.item.id}/attachments/${cacheId}`,{method:'PUT'})
    progress.remainingCacheIds=progress.remainingCacheIds.filter(id=>id!==cacheId)
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
