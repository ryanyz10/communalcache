import type { OwnedItemInfo } from './cache'
import { memberCachePage } from './db'

export async function aggregateOwnedItems(env: Env, userId: string, after: string | null) {
  const discovered = (await memberCachePage(env.DB, userId, after)).results
  // ponytail: 25 discovered caches/page, five RPCs at once; paginate rather than scan the registry.
  const page = discovered.slice(0, 25)
  const items: OwnedItemInfo[] = []
  const unavailable: string[] = []
  for (let offset = 0; offset < page.length; offset += 5) {
    const results = await Promise.all(page.slice(offset, offset + 5).map(async ({ cache_id }) => {
      try { return { cache_id, items: await env.CACHES.get(env.CACHES.idFromName(cache_id.toLowerCase())).itemsForOwner(userId) } }
      catch (error) { return { cache_id, items: [], unavailable: !(error instanceof Error && error.message === 'not_found') } }
    }))
    for (const result of results) {
      items.push(...result.items)
      if (result.unavailable) unavailable.push(result.cache_id)
    }
  }
  items.sort((left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id))
  return { items, unavailable_cache_ids: unavailable, next_cursor: discovered.length > 25 ? page.at(-1)!.cache_id : null }
}
