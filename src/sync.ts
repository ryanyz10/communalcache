import { advanceSyncCursor, registryPage, syncCursor } from './db'

export async function sweepCacheSync(env: Env) {
  const cursor = await syncCursor(env.DB)
  const page = await registryPage(env.DB, cursor)
  // ponytail: 25 sequential DO calls per Cron; durable cursor continues next tick.
  for (const cache of page.results) {
    try { await env.CACHES.get(env.CACHES.idFromName(cache.id.toLowerCase())).flushSync(true) }
    catch { console.error('Registry sync sweep could not flush a cache') }
  }
  const next = page.results.length === 25 ? page.results.at(-1)!.id : null
  await advanceSyncCursor(env.DB, cursor, next)
}
