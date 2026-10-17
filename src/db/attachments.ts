// Owner-only sharing and atomic single-cache detach cascades.
import { HttpError } from '../http'

export async function attachItem(db: D1Database, itemId: string, cacheId: string, userId: string) {
  const result = await db.prepare(`INSERT INTO item_caches(item_id,cache_id,attached_at)
    SELECT i.id,m.cache_id,? FROM items i JOIN memberships m ON m.user_id=i.owner_id AND m.status='active'
    JOIN caches c ON c.id=m.cache_id AND c.join_secret IS NOT NULL
    WHERE i.id=? AND i.owner_id=? AND m.cache_id=?
    ON CONFLICT(item_id,cache_id) DO UPDATE SET attached_at=item_caches.attached_at`)
    .bind(Date.now(), itemId, userId, cacheId).run()
  if (result.meta.changes === 0) throw new HttpError(404, 'not_found')
}

export async function detachItem(db: D1Database, itemId: string, cacheId: string, userId: string) {
  const token = crypto.randomUUID(), now = Date.now()
  const witness = `EXISTS(SELECT 1 FROM item_caches a WHERE a.item_id=? AND a.cache_id=? AND a.operation_token=?)`
  const [detached, _outbox, _requests, hints] = await db.batch([
    db.prepare(`UPDATE item_caches SET operation_token=? WHERE item_id=? AND cache_id=?
      AND EXISTS(SELECT 1 FROM items WHERE id=item_caches.item_id AND owner_id=?)
      AND EXISTS(SELECT 1 FROM memberships m JOIN caches c ON c.id=m.cache_id AND c.join_secret IS NOT NULL
        WHERE m.cache_id=item_caches.cache_id AND m.user_id=? AND m.status='active')`)
      .bind(token,itemId,cacheId,userId,userId),
    db.prepare(`INSERT INTO outbox(id,kind,dedupe_key,payload,created_at)
      SELECT r.id,'request_rejected',?||':'||r.id,json_object('event','request_rejected','cache_id',c.id,'cache_name',c.name,
        'item_id',i.id,'item_title',i.title,'request_id',r.id,'recipient_id',r.requester_id,'user_id',?,'quantity',r.quantity,'reason','item no longer shared in this cache','item_detached',json('true')),?
      FROM requests r JOIN items i ON i.id=r.item_id JOIN caches c ON c.id=r.cache_id
      WHERE r.item_id=? AND r.cache_id=? AND r.status='pending' AND ${witness}`)
      .bind(token,userId,now,itemId,cacheId,itemId,cacheId,token),
    db.prepare(`UPDATE requests SET status='rejected',decision_reason='item no longer shared in this cache',decided_at=?,decision_token=?
      WHERE item_id=? AND cache_id=? AND status='pending' AND ${witness}`)
      .bind(now,token,itemId,cacheId,itemId,cacheId,token),
    db.prepare(`SELECT id FROM outbox WHERE kind='request_rejected' AND dedupe_key>=? AND dedupe_key<? AND ${witness} ORDER BY dedupe_key LIMIT 25`)
      .bind(`${token}:`,`${token};`,itemId,cacheId,token),
    db.prepare('DELETE FROM item_caches WHERE item_id=? AND cache_id=? AND operation_token=?').bind(itemId,cacheId,token),
  ])
  if (detached.meta.changes === 0) throw new HttpError(404,'not_found')
  return (hints.results as {id:string}[]).map(row=>row.id)
}
