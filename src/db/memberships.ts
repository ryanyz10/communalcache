// Join admission, owner decisions and atomic leave/removal cascades.
import { HttpError } from '../http'
import type { CatCoat } from '../../shared/cat-coats'
import { decodedSecret, type CacheRow } from './caches'
import { cacheMemberCount, checkMembershipQuota, memberCacheCount, membershipQuotaRead, type MembershipQuota } from './limits'
import { profilePhotoVersions } from './profiles'
import { cacheRead } from './shared'

export async function cacheJoinRequests(db: D1Database, cacheId: string, userId: string) {
  const [cache, applicants] = await db.batch([
    db.prepare(`${cacheRead} AND caller.role='owner'`).bind(userId, cacheId),
    db.prepare(`SELECT m.user_id,m.created_at,u.display_name,u.cat_coat FROM memberships m JOIN user u ON u.id=m.user_id
      JOIN memberships caller ON caller.cache_id=m.cache_id AND caller.user_id=? AND caller.role='owner' AND caller.status='active'
      JOIN caches c ON c.id=m.cache_id AND c.join_secret IS NOT NULL
      WHERE m.cache_id=? AND m.status='pending' ORDER BY m.created_at,m.user_id`).bind(userId, cacheId),
  ])
  if (!cache.results.length) throw new HttpError(404, 'not_found')
  const rows = applicants.results as {user_id:string;created_at:number;display_name:string|null;cat_coat:CatCoat|null}[]
  const photos = await profilePhotoVersions(db,userId,rows.map(row=>row.user_id))
  return rows.map(row=>({...row,profile_photo_version:photos.get(row.user_id) ?? null}))
}

export async function joinCache(db: D1Database, cacheId: string, userId: string, secret: string) {
  const stored = await db.prepare('SELECT join_secret FROM caches WHERE id=? AND join_secret IS NOT NULL').bind(cacheId).first<string>('join_secret')
  const candidate = decodedSecret(secret), expected = stored ? decodedSecret(stored) : null
  if (!candidate || !expected || !crypto.subtle.timingSafeEqual(candidate, expected)) throw new HttpError(404, 'not_found')
  const token = crypto.randomUUID(), now = Date.now()
  const [inserted, outbox, membership] = await db.batch([
    db.prepare(`INSERT INTO memberships(cache_id,user_id,role,status,created_at,operation_token)
      SELECT c.id,?,'member',CASE WHEN c.requires_approval=1 THEN 'pending' ELSE 'active' END,?,? FROM caches c
      JOIN user u ON u.id=? JOIN plan_limits ul ON ul.plan=u.plan JOIN plan_limits cl ON cl.plan=c.plan
      WHERE c.id=? AND c.join_secret=?
      AND EXISTS(SELECT 1 FROM memberships WHERE cache_id=c.id AND role='owner' AND status='active')
      AND (c.requires_approval=1 OR (${memberCacheCount}<ul.member_caches AND ${cacheMemberCount}<cl.cache_members))
      AND NOT EXISTS(SELECT 1 FROM memberships WHERE cache_id=c.id AND user_id=? AND status<>'left')
      ON CONFLICT(cache_id,user_id) DO UPDATE SET status=excluded.status,created_at=excluded.created_at,operation_token=excluded.operation_token
      WHERE memberships.status='left'`)
      .bind(userId, now, token, userId, cacheId, stored, userId),
    db.prepare(`INSERT INTO outbox(id,kind,dedupe_key,payload,created_at)
      SELECT ?,'join_requested',?,json_object('event','join_requested','cache_id',c.id,'cache_name',c.name,'recipient_id',owner.user_id,'user_id',m.user_id),?
      FROM memberships m JOIN caches c ON c.id=m.cache_id
      JOIN memberships owner ON owner.cache_id=c.id AND owner.role='owner' AND owner.status='active'
      WHERE m.cache_id=? AND m.user_id=? AND m.operation_token=? AND m.status='pending'`)
      .bind(token, token, now, cacheId, userId, token),
    db.prepare(`SELECT c.id AS cache_id,c.name,m.status,${membershipQuotaRead} FROM caches c
      JOIN user u ON u.id=? LEFT JOIN memberships m ON m.cache_id=c.id AND m.user_id=u.id
      LEFT JOIN plan_limits ul ON ul.plan=u.plan LEFT JOIN plan_limits cl ON cl.plan=c.plan
      WHERE c.id=? AND c.join_secret=?
      AND EXISTS(SELECT 1 FROM memberships WHERE cache_id=c.id AND role='owner' AND status='active')`).bind(userId,cacheId,stored),
  ])
  const result = membership.results[0] as (MembershipQuota & {cache_id:string;name:string;status:'active'|'pending'|'removed'|'left'|null}) | undefined
  if (!result) throw new HttpError(404,'not_found')
  if (result.status === 'removed') throw new HttpError(403,'member_removed')
  if (result.status !== 'active' && result.status !== 'pending') {
    checkMembershipQuota(result)
    throw new HttpError(404,'not_found')
  }
  // Existing active/pending joins remain idempotent even after a downgrade.
  return { membership: {cache_id:result.cache_id,name:result.name,status:result.status}, notificationId: inserted.meta.changes > 0 && outbox.meta.changes > 0 ? token : null }
}

export async function decideCacheJoin(db: D1Database, cacheId: string, userId: string, applicantId: string, decision: 'approve' | 'reject') {
  const token = crypto.randomUUID(), now = Date.now(), event = decision === 'approve' ? 'join_approved' : 'join_rejected'
  const [updated,_outbox,_membership,quota] = await db.batch([
    db.prepare(`UPDATE memberships SET operation_token=? WHERE cache_id=? AND user_id=? AND status='pending'
      AND EXISTS(SELECT 1 FROM memberships caller JOIN caches c ON c.id=caller.cache_id
        WHERE caller.cache_id=? AND caller.user_id=? AND caller.role='owner' AND caller.status='active' AND c.join_secret IS NOT NULL)
      AND (?=0 OR EXISTS(SELECT 1 FROM caches c JOIN user u ON u.id=memberships.user_id
        JOIN plan_limits ul ON ul.plan=u.plan JOIN plan_limits cl ON cl.plan=c.plan
        WHERE c.id=memberships.cache_id AND ${memberCacheCount}<ul.member_caches AND ${cacheMemberCount}<cl.cache_members))`)
      .bind(token,cacheId,applicantId,cacheId,userId,decision === 'approve' ? 1 : 0),
    db.prepare(`INSERT INTO outbox(id,kind,dedupe_key,payload,created_at)
      SELECT ?,?,?,json_object('event',?,'cache_id',c.id,'cache_name',c.name,'recipient_id',m.user_id,'user_id',m.user_id),?
      FROM memberships m JOIN caches c ON c.id=m.cache_id WHERE m.cache_id=? AND m.user_id=? AND m.operation_token=? AND m.status='pending'`)
      .bind(token, event, token, event, now, cacheId, applicantId, token),
    decision === 'approve'
      ? db.prepare("UPDATE memberships SET status='active' WHERE cache_id=? AND user_id=? AND operation_token=? AND status='pending'").bind(cacheId, applicantId, token)
      : db.prepare("DELETE FROM memberships WHERE cache_id=? AND user_id=? AND operation_token=? AND status='pending'").bind(cacheId,applicantId,token),
    db.prepare(`SELECT m.status,${membershipQuotaRead} FROM caches c
      JOIN memberships caller ON caller.cache_id=c.id AND caller.user_id=? AND caller.role='owner' AND caller.status='active'
      LEFT JOIN user u ON u.id=? LEFT JOIN memberships m ON m.cache_id=c.id AND m.user_id=u.id
      LEFT JOIN plan_limits ul ON ul.plan=u.plan LEFT JOIN plan_limits cl ON cl.plan=c.plan
      WHERE c.id=? AND c.join_secret IS NOT NULL`).bind(userId,applicantId,cacheId),
  ])
  if (updated.meta.changes === 0) {
    const row = quota.results[0] as (MembershipQuota & {status:string|null}) | undefined
    if (!row) throw new HttpError(404,'not_found')
    if (decision === 'approve' && row.status === 'pending') checkMembershipQuota(row)
    throw new HttpError(409,'join_not_pending')
  }
  return { status: decision === 'approve' ? 'active' : 'rejected', notificationId: token }
}

export async function removeCacheMember(db: D1Database, cacheId: string, actorId: string, memberId: string, leaving = false) {
  const token = crypto.randomUUID(), now = Date.now(), status = leaving ? 'left' : 'removed'
  const witness = `EXISTS(SELECT 1 FROM memberships m WHERE m.cache_id=? AND m.user_id=? AND m.operation_token=?)`
  const [removed, _outbox, _requests, _attachments, hints] = await db.batch([
    db.prepare(`UPDATE memberships SET status=?,operation_token=? WHERE cache_id=? AND user_id=? AND status='active' AND role='member'
      AND EXISTS(SELECT 1 FROM caches c JOIN memberships caller ON caller.cache_id=c.id AND caller.user_id=? AND caller.status='active'
        WHERE c.id=? AND c.join_secret IS NOT NULL AND ((?=1 AND caller.user_id=?) OR (?=0 AND caller.role='owner')))`)
      .bind(status,token,cacheId,memberId,actorId,cacheId,leaving ? 1 : 0,memberId,leaving ? 1 : 0),
    db.prepare(`INSERT INTO outbox(id,kind,dedupe_key,payload,created_at)
      SELECT r.id,'member_removed',?||':'||r.id,json_object('event','member_removed','cache_id',c.id,'cache_name',c.name,
        'item_id',i.id,'item_title',i.title,'request_id',r.id,'recipient_id',r.requester_id,'user_id',?,'quantity',r.quantity,'reason','left the cache'),?
      FROM requests r JOIN items i ON i.id=r.item_id JOIN caches c ON c.id=r.cache_id
      WHERE r.cache_id=? AND r.status='pending' AND (r.requester_id=? OR i.owner_id=?) AND ${witness}`)
      .bind(token,actorId,now,cacheId,memberId,memberId,cacheId,memberId,token),
    db.prepare(`UPDATE requests SET status='rejected',decision_reason='left the cache',decided_at=?,decision_token=?
      WHERE cache_id=? AND status='pending' AND (requester_id=? OR item_id IN(SELECT id FROM items WHERE owner_id=?)) AND ${witness}`)
      .bind(now,token,cacheId,memberId,memberId,cacheId,memberId,token),
    db.prepare(`DELETE FROM item_caches WHERE cache_id=? AND item_id IN(SELECT id FROM items WHERE owner_id=?) AND ${witness}`)
      .bind(cacheId,memberId,cacheId,memberId,token),
    // State/snapshots cover every affected row; only immediate Queue hints are bounded.
    db.prepare(`SELECT id FROM outbox WHERE kind='member_removed' AND dedupe_key>=? AND dedupe_key<? AND ${witness} ORDER BY dedupe_key LIMIT 25`)
      .bind(`${token}:`,`${token};`,cacheId,memberId,token),
  ])
  if (removed.meta.changes === 0) {
    const cache = await db.prepare(cacheRead).bind(actorId,cacheId).first<CacheRow>()
    if (!cache || (!leaving && cache.owner_id !== actorId)) throw new HttpError(404,'not_found')
    if (leaving && cache.owner_id === actorId) throw new HttpError(409,'owner_cannot_leave')
    if (!leaving && cache.owner_id === memberId) throw new HttpError(409,'owner_cannot_be_removed')
    throw new HttpError(404,'not_found')
  }
  return (hints.results as {id:string}[]).map(row=>row.id)
}
