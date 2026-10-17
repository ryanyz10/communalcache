import { advanceCleanupCursor, claimCleanup, cleanupCursor, cleanupPage, cleanupPageSize, finishCleanup } from './db'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function sweepPhotoCleanup(env: Env) {
  const cursor = await cleanupCursor(env.DB)
  const page = (await cleanupPage(env.DB, cursor)).results
  // ponytail: 23 D1 queries plus at most 20 R2 calls leave room for notification rescue.
  for (const { id } of page) {
    const token = crypto.randomUUID()
    const row = await claimCleanup(env.DB, id, token, Date.now())
    if (!row) continue
    let finishing = false
    try {
      if (!uuid.test(row.owner_id)) throw new Error('Invalid cleanup owner')
      const prefix = row.scope === 'profile' ? `users/${row.owner_id}/` : `${row.owner_id}/${row.item_id}/`
      const invalidScope = row.scope === 'profile'
        ? row.item_id !== null || row.kind !== 'exact'
        : !row.item_id || !uuid.test(row.item_id)
      if (invalidScope) throw new Error('Invalid cleanup scope')
      const invalidTarget = row.kind === 'prefix'
        ? row.target !== prefix
        : !row.target.startsWith(prefix) || !uuid.test(row.target.slice(prefix.length))
      if (invalidTarget) throw new Error('Invalid cleanup target')
      let done = true
      if (row.kind === 'exact') await env.BUCKET.delete(row.target)
      else {
        const objects = await env.BUCKET.list({ prefix, limit: 100 })
        if (objects.objects.length) {
          await env.BUCKET.delete(objects.objects.map(object => object.key))
          done = false
        }
      }
      finishing = true
      await finishCleanup(env.DB, id, token, done)
    } catch {
      // A failed completion keeps its lease for retry; do not spend a second D1 call.
      if (!finishing) await finishCleanup(env.DB, id, token, false).catch(() => {})
      console.error(JSON.stringify({ event: 'photo_cleanup_failed', cleanup_id: id, oldest_pending_age_ms: Math.max(0, Date.now() - row.created_at) }))
    }
  }
  await advanceCleanupCursor(env.DB, cursor, page.length === cleanupPageSize ? page.at(-1)!.id : null)
}
