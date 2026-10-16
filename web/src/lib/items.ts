import { useInfiniteQuery } from '@tanstack/react-query'
import { apiFetch } from './api'
import type { CatCoat } from './cats'

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
export type LibraryPageData = { items: LibraryItem[]; next_cursor: string | null }

export function useLibrary(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['library', userId], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiFetch<LibraryPageData>(`/api/me/items${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: page => page.next_cursor ?? undefined, enabled: !!userId,
  })
}

export function sharingHint(item: LibraryItem, cacheId?: string) {
  if (cacheId && item.caches.some(cache => cache.id === cacheId)) return 'Already here'
  const names = item.caches.map(cache => cache.name).join(', ')
  return names ? `${cacheId ? 'Also in ' : ''}${names}` : 'Not in a cache yet'
}

export async function attachSelected(itemIds: string[], cacheId: string, attached: (id: string) => void) {
  // Keep successes when a later attach fails; retry only the remaining selection.
  for (const id of itemIds) {
    await apiFetch(`/api/me/items/${id}/attachments/${cacheId}`, { method: 'PUT' })
    attached(id)
  }
}
