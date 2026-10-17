// Private item/profile photo authorization and post-R2 token-guarded finalization.
import { HttpError } from '../http'
import { checkQuota } from './limits'
import { itemAccess, profilePhotoAccess } from './shared'

export async function profilePhotoKey(db: D1Database, ownerId: string, readerId: string) {
  const key = await db.prepare(`SELECT p.photo_path FROM user u JOIN user_photos p ON p.user_id=u.id
    WHERE u.id=? AND (${profilePhotoAccess})`).bind(ownerId,readerId,readerId).first<string>('photo_path')
  if (!key) throw new HttpError(404,'not_found')
  return key
}

export async function finishProfilePhoto(db: D1Database, userId: string, key: string, uploaded: boolean) {
  const prefix = `users/${userId}/`
  if (!key.startsWith(prefix) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key.slice(prefix.length))) throw new HttpError(404,'not_found')
  const token = crypto.randomUUID(), now = Date.now()
  const [marked,_cleanup,_photo,quota] = await db.batch([
    db.prepare(`INSERT INTO user_photos(user_id,photo_path,operation_token)
      SELECT u.id,?,? FROM user u JOIN plan_limits l ON l.plan=u.plan WHERE u.id=? AND ?=1 AND l.profile_photos>0
      AND NOT EXISTS(SELECT 1 FROM r2_cleanup WHERE (kind='exact' AND target=?) OR (kind='prefix' AND substr(?,1,length(target))=target))
      ON CONFLICT(user_id) DO UPDATE SET operation_token=excluded.operation_token`).bind(key,token,userId,uploaded?1:0,key,key),
    db.prepare(`INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at,scope)
      SELECT ?,user_id,NULL,'exact',photo_path,?,'profile' FROM user_photos WHERE user_id=? AND operation_token=? AND photo_path<>?
      ON CONFLICT(kind,target) DO NOTHING`).bind(crypto.randomUUID(),now,userId,token,key),
    db.prepare('UPDATE user_photos SET photo_path=? WHERE user_id=? AND operation_token=?').bind(key,userId,token),
    db.prepare(`SELECT l.profile_photos AS maximum FROM user u LEFT JOIN plan_limits l ON l.plan=u.plan
      WHERE u.id=? AND ?=1`).bind(userId,uploaded?1:0),
  ])
  if (marked.meta.changes === 0) {
    await db.prepare(`INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at,scope)
      SELECT ?,?,NULL,'exact',?,?,'profile' WHERE NOT EXISTS(SELECT 1 FROM user_photos WHERE photo_path=?)
      ON CONFLICT(kind,target) DO NOTHING`).bind(crypto.randomUUID(),userId,key,now,key).run()
    const row = quota.results[0] as {maximum:number|null} | undefined
    if (row) checkQuota('profile_photos',0,row.maximum)
  }
  return marked.meta.changes>0
}

export async function removeProfilePhoto(db: D1Database, userId: string) {
  const token = crypto.randomUUID(), now = Date.now()
  const [_marked,_cleanup,_photo,user] = await db.batch([
    db.prepare(`UPDATE user_photos SET operation_token=? WHERE user_id=?
      AND EXISTS(SELECT 1 FROM user WHERE id=user_photos.user_id)`).bind(token,userId),
    db.prepare(`INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at,scope)
      SELECT ?,user_id,NULL,'exact',photo_path,?,'profile' FROM user_photos WHERE user_id=? AND operation_token=?
      ON CONFLICT(kind,target) DO NOTHING`).bind(crypto.randomUUID(),now,userId,token),
    db.prepare('DELETE FROM user_photos WHERE user_id=? AND operation_token=?').bind(userId,token),
    db.prepare('SELECT id FROM user WHERE id=?').bind(userId),
  ])
  if (!user.results.length) throw new HttpError(404,'not_found')
}

export async function finishItemPhoto(db: D1Database, itemId: string, userId: string, key: string, uploaded: boolean, cacheId: string | null = null) {
  const prefix = `${userId}/${itemId}/`
  if (!key.startsWith(prefix) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key.slice(prefix.length))) throw new HttpError(404, 'not_found')
  const token = crypto.randomUUID(), now = Date.now()
  const [marked,_cleanup,_photo,quota] = await db.batch([
    db.prepare(`UPDATE items AS i SET operation_token=? WHERE i.id=? AND i.owner_id=? AND ?=1 AND (${itemAccess})
      AND EXISTS(SELECT 1 FROM user u JOIN plan_limits l ON l.plan=u.plan WHERE u.id=i.owner_id AND l.photos_per_item>0)
      AND NOT EXISTS(SELECT 1 FROM r2_cleanup WHERE (kind='exact' AND target=?) OR (kind='prefix' AND substr(?,1,length(target))=target))`)
      .bind(token, itemId, userId, uploaded ? 1 : 0, cacheId, userId, userId, cacheId, key, key),
    db.prepare(`INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at)
      SELECT ?,owner_id,id,'exact',photo_path,? FROM items WHERE id=? AND owner_id=? AND operation_token=? AND photo_path IS NOT NULL AND photo_path<>?
      ON CONFLICT(kind,target) DO NOTHING`).bind(crypto.randomUUID(), now, itemId, userId, token, key),
    db.prepare('UPDATE items SET photo_path=? WHERE id=? AND owner_id=? AND operation_token=?').bind(key,itemId,userId,token),
    db.prepare(`SELECT l.photos_per_item AS maximum FROM items i JOIN user u ON u.id=i.owner_id
      LEFT JOIN plan_limits l ON l.plan=u.plan WHERE i.id=? AND i.owner_id=? AND ?=1 AND (${itemAccess})`)
      .bind(itemId,userId,uploaded ? 1 : 0,cacheId,userId,userId,cacheId),
  ])
  if (marked.meta.changes === 0) {
    // Independent guarded repair for bytes already written, not a grant from the failed mutation.
    await db.prepare(`INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at)
      SELECT ?,?,?,'exact',?,? WHERE NOT EXISTS(SELECT 1 FROM items WHERE photo_path=?)
      ON CONFLICT(kind,target) DO NOTHING`).bind(crypto.randomUUID(),userId,itemId,key,now,key).run()
    const row = quota.results[0] as {maximum:number|null} | undefined
    if (row) checkQuota('photos_per_item',0,row.maximum)
  }
  return marked.meta.changes > 0
}
