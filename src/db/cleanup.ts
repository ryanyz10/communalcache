// Durable private-R2 cleanup claims and fair bounded pagination.
export type CleanupRow = { id: string; owner_id: string; item_id: string | null; scope: 'item' | 'profile'; kind: 'exact' | 'prefix'; target: string; created_at: number }

export function cleanupCursor(db: D1Database) {
  return db.prepare('SELECT cleanup_id FROM r2_cleanup_cursor WHERE singleton=1').first<string | null>('cleanup_id')
}

export function cleanupPage(db: D1Database, after: string | null) {
  return db.prepare('SELECT id FROM r2_cleanup WHERE (? IS NULL OR id>?) ORDER BY id LIMIT 2').bind(after, after).all<{ id: string }>()
}

export async function claimCleanup(db: D1Database, id: string, token: string, now: number) {
  const result = await db.prepare(`UPDATE r2_cleanup SET claim_token=?,claim_until=? WHERE id=? AND (claim_until IS NULL OR claim_until<=?)
    AND NOT EXISTS(SELECT 1 FROM items WHERE (r2_cleanup.kind='exact' AND photo_path=r2_cleanup.target)
      OR (r2_cleanup.kind='prefix' AND substr(photo_path,1,length(r2_cleanup.target))=r2_cleanup.target))
    AND NOT EXISTS(SELECT 1 FROM user_photos WHERE (r2_cleanup.kind='exact' AND photo_path=r2_cleanup.target)
      OR (r2_cleanup.kind='prefix' AND substr(photo_path,1,length(r2_cleanup.target))=r2_cleanup.target))
    RETURNING id,owner_id,item_id,kind,target,created_at,scope`).bind(token,now+90_000,id,now).all<CleanupRow>()
  return result.meta.changes > 0 ? result.results[0] : null
}

export function finishCleanup(db: D1Database, id: string, token: string, done: boolean) {
  const now = Date.now()
  return db.prepare(done
    ? 'DELETE FROM r2_cleanup WHERE id=? AND claim_token=? AND claim_until>?'
    : 'UPDATE r2_cleanup SET claim_token=NULL,claim_until=NULL WHERE id=? AND claim_token=? AND claim_until>?')
    .bind(id, token, now).run()
}

export function advanceCleanupCursor(db: D1Database, previous: string | null, next: string | null) {
  return db.prepare('UPDATE r2_cleanup_cursor SET cleanup_id=? WHERE singleton=1 AND cleanup_id IS ?').bind(next, previous).run()
}
