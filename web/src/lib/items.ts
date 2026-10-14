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
