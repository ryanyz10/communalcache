// Cache discovery, Home summaries, owner settings and limited invite previews.
import { HttpError } from '../http'
import type { CatCoat } from '../../shared/cat-coats'
import { catTraits, type CatTraits } from '../../shared/cats'
import { checkMembershipQuota, checkQuota, memberCacheCount, ownedCacheCount, type MembershipQuota } from './limits'
import { photoVersion, profilePhotoVersions } from './profiles'
import { cacheRead, requestContext } from './shared'

export async function listMyCaches(db: D1Database, userId: string) {
  const rows = await db.prepare(`SELECT c.id,c.name,owner.user_id AS owner_id,c.requires_approval,
    (SELECT COUNT(*) FROM memberships WHERE cache_id=c.id AND status='active') AS active_member_count,
    (SELECT COUNT(*) FROM item_caches a JOIN items i ON i.id=a.item_id
      JOIN memberships member ON member.cache_id=a.cache_id AND member.user_id=i.owner_id AND member.status='active'
      WHERE a.cache_id=c.id) AS attached_item_count,
    (SELECT COUNT(*) FROM requests r JOIN items i ON i.id=r.item_id
      WHERE r.cache_id=c.id AND i.owner_id=m.user_id AND r.status='pending' AND ${requestContext}) AS pending_answer_count,
    (SELECT json_group_array(json_object('user_id',preview.user_id,'display_name',preview.display_name,
      'cat_coat',preview.cat_coat,'profile_photo_version',preview.photo_path)) FROM (
        SELECT member.user_id,u.display_name,u.cat_coat,p.photo_path FROM memberships member
        JOIN user u ON u.id=member.user_id LEFT JOIN user_photos p ON p.user_id=u.id
        WHERE member.cache_id=c.id AND member.status='active'
        ORDER BY (member.user_id=m.user_id) DESC,member.created_at,member.user_id LIMIT 3
      ) preview) AS members_json
    FROM caches c JOIN memberships m ON m.cache_id=c.id AND m.user_id=? AND m.status='active'
    JOIN memberships owner ON owner.cache_id=c.id AND owner.role='owner' AND owner.status='active'
    WHERE c.join_secret IS NOT NULL ORDER BY c.created_at DESC,c.id`).bind(userId)
    .all<{id:string;name:string;owner_id:string;requires_approval:number;active_member_count:number;attached_item_count:number;pending_answer_count:number;members_json:string}>()
  return {...rows,results:rows.results.map(({members_json,requires_approval,...row})=>({
    ...row,requires_approval:requires_approval===1,
    member_preview:(JSON.parse(members_json) as {user_id:string;display_name:string|null;cat_coat:CatCoat|null;profile_photo_version:string|null}[])
      .map(member=>({...member,profile_photo_version:photoVersion(member.profile_photo_version)})),
  }))}
}

export async function homeSummary(db: D1Database, userId: string) {
  // Current-context previews never turn retained request history into a cache grant.
  const incoming = `FROM requests r JOIN items i ON i.id=r.item_id
    JOIN user person ON person.id=r.requester_id LEFT JOIN user_photos p ON p.user_id=person.id
    WHERE i.owner_id=? AND r.status='pending' AND ${requestContext}`
  const [counts,previews,outgoing] = await db.batch([
    db.prepare(`SELECT (SELECT COUNT(*) FROM items WHERE owner_id=?) AS owned_item_count,
      (SELECT COUNT(*) ${incoming}) AS pending_answer_count`).bind(userId,userId),
    db.prepare(`SELECT r.id,r.cache_id,r.item_id,i.title AS item_title,r.quantity,r.created_at,
      person.id AS user_id,person.display_name,person.cat_coat,p.photo_path ${incoming}
      ORDER BY r.created_at DESC,r.id DESC LIMIT 2`).bind(userId),
    db.prepare(`SELECT r.id,r.cache_id,r.item_id,i.title AS item_title,r.status,r.created_at,
      person.id AS user_id,person.display_name,person.cat_coat,p.photo_path
      FROM requests r JOIN items i ON i.id=r.item_id JOIN user person ON person.id=i.owner_id
      LEFT JOIN user_photos p ON p.user_id=person.id
      WHERE r.requester_id=? AND ${requestContext} ORDER BY r.created_at DESC,r.id DESC LIMIT 3`).bind(userId),
  ])
  type Preview = {id:string;cache_id:string;item_id:string;item_title:string;user_id:string;display_name:string|null;cat_coat:CatCoat|null;photo_path:string|null;created_at:number}
  const display = <T extends Preview>({photo_path,...row}:T) => ({...row,profile_photo_version:photoVersion(photo_path)})
  return {...counts.results[0] as {owned_item_count:number;pending_answer_count:number},
    incoming:(previews.results as (Preview & {quantity:number|null})[]).map(display),
    outgoing:(outgoing.results as (Preview & {status:'pending'|'approved'|'rejected'})[]).map(display)}
}

export type CacheInfo = { id: string; name: string; owner_id: string; invite_token: string; requires_approval: boolean }
export type CacheRow = { id: string; name: string; owner_id: string; join_secret: string; requires_approval: number }

function cacheInfo(row: CacheRow): CacheInfo {
  return { id: row.id, name: row.name, owner_id: row.owner_id, invite_token: `${row.id}.${row.join_secret}`, requires_approval: row.requires_approval === 1 }
}

function newJoinSecret() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function decodedSecret(secret: string) {
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(secret)) return null
  return Uint8Array.from(atob(secret.replaceAll('-', '+').replaceAll('_', '/') + '='), char => char.charCodeAt(0))
}

export type InvitePreview = { name: string; active_member_count: number; members: CatTraits[] }

export async function invitePreview(db: D1Database, cacheId: string, userId: string, secret: string): Promise<InvitePreview> {
  if (!decodedSecret(secret)) throw new HttpError(404,'not_found')
  // The current secret, removed denial and all preview fields share one D1 snapshot.
  const row = await db.prepare(`SELECT caller.status='removed' AS removed,
    CASE WHEN caller.status='removed' THEN NULL ELSE c.name END AS name,
    CASE WHEN caller.status='removed' THEN 0 ELSE
      (SELECT COUNT(*) FROM memberships WHERE cache_id=c.id AND status='active') END AS active_member_count,
    CASE WHEN caller.status='removed' THEN '[]' ELSE
      (SELECT json_group_array(json_object('user_id',member.user_id,'cat_coat',member.cat_coat)) FROM (
        SELECT m.user_id,u.cat_coat FROM memberships m JOIN user u ON u.id=m.user_id
        WHERE m.cache_id=c.id AND m.status='active' ORDER BY m.created_at,m.user_id LIMIT 5
      ) member) END AS members_json
    FROM caches c JOIN user viewer ON viewer.id=?
    JOIN memberships owner ON owner.cache_id=c.id AND owner.role='owner' AND owner.status='active'
    LEFT JOIN memberships caller ON caller.cache_id=c.id AND caller.user_id=viewer.id
    WHERE c.id=? AND c.join_secret=?`).bind(userId,cacheId,secret)
    .first<{removed:number|null;name:string|null;active_member_count:number;members_json:string}>()
  if (!row) throw new HttpError(404,'not_found')
  if (row.removed) throw new HttpError(403,'member_removed')
  const members = JSON.parse(row.members_json) as {user_id:string;cat_coat:CatCoat|null}[]
  return {name:row.name!,active_member_count:row.active_member_count,members:members.map(member=>catTraits(member.user_id,member.cat_coat))}
}

export async function createCache(db: D1Database, ownerId: string, name: string, requiresApproval: boolean) {
  const id = crypto.randomUUID(), token = crypto.randomUUID(), secret = newJoinSecret(), now = Date.now()
  const recentCount = `(SELECT COUNT(*) FROM caches recent JOIN memberships owner ON owner.cache_id=recent.id
    AND owner.user_id=u.id AND owner.role='owner' AND owner.status='active' WHERE recent.created_at>? AND recent.join_secret IS NOT NULL)`
  const [created,_owner,quota] = await db.batch([
    db.prepare(`INSERT INTO caches(id,name,created_at,join_secret,requires_approval,operation_token)
      SELECT ?,?,?,?,?,? FROM user u JOIN plan_limits ul ON ul.plan=u.plan JOIN plan_limits cl ON cl.plan='free'
      WHERE u.id=? AND ${ownedCacheCount}<ul.owned_caches AND ${recentCount}<ul.new_caches_per_day
      AND ${memberCacheCount}<ul.member_caches AND cl.cache_members>0`)
      .bind(id,name,now,secret,requiresApproval ? 1 : 0,token,ownerId,now-86_400_000),
    db.prepare(`INSERT INTO memberships(cache_id,user_id,role,status,created_at)
      SELECT id,?,'owner','active',? FROM caches WHERE id=? AND operation_token=?`).bind(ownerId,now,id,token),
    // Diagnostics share the failed write's snapshot, never authorize a later retry.
    db.prepare(`SELECT ${ownedCacheCount} AS owned_used,ul.owned_caches AS owned_limit,
      ${recentCount} AS recent_used,ul.new_caches_per_day AS recent_limit,
      ${memberCacheCount} AS member_used,ul.member_caches AS member_limit,0 AS cache_used,cl.cache_members AS cache_limit
      FROM user u LEFT JOIN plan_limits ul ON ul.plan=u.plan LEFT JOIN plan_limits cl ON cl.plan='free' WHERE u.id=?`)
      .bind(now-86_400_000,ownerId),
  ])
  if (created.meta.changes === 0) {
    const row = quota.results[0] as (MembershipQuota & {owned_used:number;owned_limit:number|null;recent_used:number;recent_limit:number|null}) | undefined
    if (!row) throw new HttpError(404,'not_found')
    checkQuota('owned_caches',row.owned_used,row.owned_limit)
    checkQuota('new_caches_per_day',row.recent_used,row.recent_limit)
    checkMembershipQuota(row)
    throw new Error('Cache quota guard failed')
  }
  return cacheInfo({ id, name, owner_id: ownerId, join_secret: secret, requires_approval: requiresApproval ? 1 : 0 })
}

export async function cacheDetail(db: D1Database, cacheId: string, userId: string) {
  const [cache, members] = await db.batch([
    db.prepare(cacheRead).bind(userId, cacheId),
    db.prepare(`SELECT m.user_id,u.display_name,u.cat_coat,
      (SELECT COUNT(*) FROM item_caches a JOIN items i ON i.id=a.item_id
        WHERE a.cache_id=m.cache_id AND i.owner_id=m.user_id) AS attached_item_count
      FROM memberships m JOIN user u ON u.id=m.user_id
      JOIN memberships caller ON caller.cache_id=m.cache_id AND caller.user_id=? AND caller.status='active'
      JOIN caches c ON c.id=m.cache_id AND c.join_secret IS NOT NULL
      WHERE m.cache_id=? AND m.status='active' ORDER BY m.created_at,m.user_id`).bind(userId, cacheId),
  ])
  if (!cache.results.length) throw new HttpError(404, 'not_found')
  const rows = members.results as {user_id:string;display_name:string|null;cat_coat:CatCoat|null;attached_item_count:number}[]
  const photos = await profilePhotoVersions(db,userId,rows.map(row=>row.user_id))
  return {...cacheInfo(cache.results[0] as CacheRow),members:rows.map(row=>({...row,profile_photo_version:photos.get(row.user_id) ?? null}))}
}

export async function updateCache(db: D1Database, cacheId: string, userId: string, changes: { name?: string; requires_approval?: boolean }, rotate = false) {
  const token = crypto.randomUUID()
  const [updated, cache] = await db.batch([
    db.prepare(`UPDATE caches SET name=COALESCE(?,name),requires_approval=COALESCE(?,requires_approval),
      join_secret=COALESCE(?,join_secret),operation_token=? WHERE id=? AND join_secret IS NOT NULL
      AND EXISTS(SELECT 1 FROM memberships WHERE cache_id=caches.id AND user_id=? AND role='owner' AND status='active')`)
      .bind(changes.name ?? null, changes.requires_approval === undefined ? null : changes.requires_approval ? 1 : 0, rotate ? newJoinSecret() : null, token, cacheId, userId),
    db.prepare(`${cacheRead} AND c.operation_token=?`).bind(userId, cacheId, token),
  ])
  if (updated.meta.changes === 0) throw new HttpError(404, 'not_found')
  return cacheInfo(cache.results[0] as CacheRow)
}
