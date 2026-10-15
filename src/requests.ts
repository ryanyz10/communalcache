import type { RequestInfo } from './cache'
import { displayNames, memberCachePage } from './db'

export async function enrichRequests(db: D1Database, requests: RequestInfo[]) {
  const names = await displayNames(db, [...new Set(requests.flatMap(row => [row.requester_id, row.owner_id]))])
  return requests.map(row => ({ ...row, requester_name: names.get(row.requester_id) ?? null, owner_name: names.get(row.owner_id) ?? null }))
}

export async function aggregateRequests(env: Env, userId: string, after: string | null) {
  const discovered = (await memberCachePage(env.DB, userId, after)).results
  // ponytail: 25 caches/page (below the 50 ceiling), five RPCs at once, leaving binding budget for auth/names.
  // Raise only with measured budgets; use continuation rather than a registry-wide fan-out.
  const page = discovered.slice(0, 25)
  const requests: RequestInfo[] = []
  const unavailable: string[] = []
  for (let offset = 0; offset < page.length; offset += 5) {
    const results = await Promise.all(page.slice(offset, offset + 5).map(async ({ cache_id }) => {
      try { return { cache_id, requests: await env.CACHES.get(env.CACHES.idFromName(cache_id.toLowerCase())).requestsForMember(userId) } }
      catch (error) { return { cache_id, requests: [], unavailable: !(error instanceof Error && error.message === 'not_found') } }
    }))
    for (const result of results) {
      requests.push(...result.requests)
      if (result.unavailable) unavailable.push(result.cache_id)
    }
  }
  requests.sort((left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id))
  return { requests: await enrichRequests(env.DB, requests), unavailable_cache_ids: unavailable, next_cursor: discovered.length > 25 ? page.at(-1)!.cache_id : null }
}
