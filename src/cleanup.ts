import { advanceCleanupCursor, claimCleanup, cleanupCursor, cleanupPage, finishCleanup } from './db'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function sweepPhotoCleanup(env: Env) {
  const cursor = await cleanupCursor(env.DB)
  const page = (await cleanupPage(env.DB, cursor)).results
  // ponytail: two intents (one 100-key prefix page each) leave headroom alongside outbox recovery.
  for (const { id } of page) {
    const token = crypto.randomUUID()
    const row = await claimCleanup(env.DB, id, token, Date.now())
    if (!row) continue
    try {
      const prefix = `${row.owner_id}/${row.item_id}/`
      if (!uuid.test(row.owner_id) || !uuid.test(row.item_id)
        || (row.kind === 'prefix' ? row.target !== prefix : !row.target.startsWith(prefix) || !uuid.test(row.target.slice(prefix.length)))) throw new Error('Invalid cleanup scope')
      let done = true
      if (row.kind === 'exact') await env.BUCKET.delete(row.target)
      else {
        const objects = await env.BUCKET.list({ prefix, limit: 100 })
        if (objects.objects.length) {
          await env.BUCKET.delete(objects.objects.map(object => object.key))
          done = false
        }
      }
      await finishCleanup(env.DB, id, token, done)
    } catch {
      await finishCleanup(env.DB, id, token, false).catch(() => {})
      console.error(JSON.stringify({ event: 'photo_cleanup_failed', cleanup_id: id, oldest_pending_age_ms: Math.max(0, Date.now() - row.created_at) }))
    }
  }
  await advanceCleanupCursor(env.DB, cursor, page.length === 2 ? page.at(-1)!.id : null)
}
