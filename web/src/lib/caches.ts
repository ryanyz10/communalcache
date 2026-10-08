export type CacheSummary = { id: string; name: string }
export type CacheInfo = CacheSummary & { owner_id: string; invite_token: string; requires_approval: boolean }
export type CacheDetail = CacheInfo & { members: { user_id: string; display_name: string | null }[] }
