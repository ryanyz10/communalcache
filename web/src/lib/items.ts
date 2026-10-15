export type OwnedItem = Omit<Item, 'owner_name'> & { cache_name: string; pending_request_count: number }
export type OwnedItemsPage = { items: OwnedItem[]; unavailable_cache_ids: string[]; next_cursor: string | null }

export type Item = {
  id: string
  cache_id: string
  owner_id: string
  owner_name: string | null
  title: string
  description: string | null
  is_consumable: boolean
  quantity: number | null
  created_at: number
  photo_version: string | null
}
