// Privileged operational metadata only: never authentication/contact data or payloads.
import { HttpError } from '../http'
import { memberCacheCount, openRequestCount, ownedCacheCount, ownedItemCount } from './limits'

export type AdminActor = { userId: string; sessionToken: string }
const currentAdminSession = `EXISTS(SELECT 1 FROM session s WHERE s.userId=? AND s.token=? AND s.expiresAt>?)`

export async function adminOverview(db: D1Database, actor: AdminActor) {
  const now = Date.now(), stamp = new Date(now).toISOString()
  const [counts, plans] = await db.batch([
    db.prepare(`SELECT (SELECT COUNT(*) FROM user) AS users,
      (SELECT COUNT(*) FROM caches WHERE join_secret IS NOT NULL) AS caches,
      (SELECT COUNT(*) FROM items) AS items,
      (SELECT COUNT(*) FROM requests WHERE status='pending') AS pending_requests,
      (SELECT COUNT(*) FROM outbox WHERE sent_at IS NULL AND failed_at IS NULL) AS outbox_pending,
      (SELECT MIN(created_at) FROM outbox WHERE sent_at IS NULL AND failed_at IS NULL) AS oldest_outbox_at,
      (SELECT COUNT(*) FROM outbox WHERE failed_at IS NOT NULL) AS outbox_failed,
      (SELECT COUNT(*) FROM r2_cleanup) AS cleanup_pending,
      (SELECT MIN(created_at) FROM r2_cleanup) AS oldest_cleanup_at
      WHERE ${currentAdminSession}`).bind(actor.userId, actor.sessionToken, stamp),
    db.prepare(`SELECT plan,owned_caches,new_caches_per_day,member_caches,cache_members,owned_items,open_requests,photos_per_item,profile_photos
      FROM plan_limits WHERE ${currentAdminSession} ORDER BY plan`).bind(actor.userId, actor.sessionToken, stamp),
  ])
  const row = counts.results[0] as { users: number; caches: number; items: number; pending_requests: number; outbox_pending: number; oldest_outbox_at: number | null; outbox_failed: number; cleanup_pending: number; oldest_cleanup_at: number | null } | undefined
  if (!row) throw new HttpError(404, 'not_found')
  return { ...row, outbox_oldest_age_ms: row.oldest_outbox_at === null ? null : Math.max(0, now - row.oldest_outbox_at),
    cleanup_oldest_age_ms: row.oldest_cleanup_at === null ? null : Math.max(0, now - row.oldest_cleanup_at), plans: plans.results }
}

export async function adminCaches(db: D1Database, actor: AdminActor, after: string | null) {
  const rows = await db.prepare(`SELECT c.id,c.name,c.plan,owner.user_id AS owner_id,u.display_name AS owner_name,
    (SELECT COUNT(*) FROM memberships WHERE cache_id=c.id AND status='active') AS member_count,
    l.cache_members AS member_limit,(SELECT COUNT(*) FROM item_caches a JOIN items i ON i.id=a.item_id WHERE a.cache_id=c.id AND i.active=1) AS item_count
    FROM caches c LEFT JOIN memberships owner ON owner.cache_id=c.id AND owner.role='owner' AND owner.status='active'
    LEFT JOIN user u ON u.id=owner.user_id LEFT JOIN plan_limits l ON l.plan=c.plan
    WHERE c.join_secret IS NOT NULL AND (? IS NULL OR c.id>?) AND ${currentAdminSession} ORDER BY c.id LIMIT 26`)
    .bind(after, after, actor.userId, actor.sessionToken, new Date().toISOString()).all()
  return { rows: rows.results.slice(0, 25), next_cursor: rows.results.length > 25 ? rows.results[24].id as string : null }
}

export async function adminUsers(db: D1Database, actor: AdminActor, after: string | null) {
  const now = Date.now()
  const rows = await db.prepare(`SELECT u.id,u.display_name,u.plan,${ownedCacheCount} AS owned_caches,l.owned_caches AS owned_cache_limit,
    ${ownedItemCount} AS owned_items,l.owned_items AS owned_item_limit,${openRequestCount} AS pending_outgoing,l.open_requests AS pending_limit,
    ${memberCacheCount} AS memberships,l.member_caches AS membership_limit,
    (SELECT COUNT(*) FROM caches recent JOIN memberships owner ON owner.cache_id=recent.id AND owner.user_id=u.id
      AND owner.role='owner' AND owner.status='active' WHERE recent.created_at>? AND recent.join_secret IS NOT NULL) AS new_caches_24h,
    l.new_caches_per_day AS new_cache_limit,(SELECT COUNT(*) FROM user_photos WHERE user_id=u.id) AS profile_photos,l.profile_photos AS profile_photo_limit
    FROM user u LEFT JOIN plan_limits l ON l.plan=u.plan
    WHERE (? IS NULL OR u.id>?) AND ${currentAdminSession} ORDER BY u.id LIMIT 26`)
    .bind(now - 86_400_000, after, after, actor.userId, actor.sessionToken, new Date(now).toISOString()).all()
  return { rows: rows.results.slice(0, 25), next_cursor: rows.results.length > 25 ? rows.results[24].id as string : null }
}

export async function adminFailedOutbox(db: D1Database, actor: AdminActor, after: string | null) {
  // Delivery currently records no classified error; never infer it from private payloads.
  const rows = await db.prepare(`SELECT id,kind,created_at,failed_at,attempts,NULL AS error_class FROM outbox
    WHERE failed_at IS NOT NULL AND (? IS NULL OR id>?) AND ${currentAdminSession} ORDER BY id LIMIT 26`)
    .bind(after, after, actor.userId, actor.sessionToken, new Date().toISOString()).all()
  return { rows: rows.results.slice(0, 25), next_cursor: rows.results.length > 25 ? rows.results[24].id as string : null }
}

export async function adminFlags(db: D1Database, actor: AdminActor) {
  const rows = await db.prepare(`SELECT key,enabled,updated_at FROM feature_flags WHERE ${currentAdminSession} ORDER BY key`)
    .bind(actor.userId, actor.sessionToken, new Date().toISOString()).all<{ key: string; enabled: number; updated_at: number }>()
  return rows.results.map(row => ({ ...row, enabled: row.enabled === 1 }))
}

export async function adminSetFlag(db: D1Database, actor: AdminActor, key: string, enabled: boolean) {
  const now = Date.now()
  const result = await db.prepare(`UPDATE feature_flags SET enabled=?,updated_at=?,updated_by=?
    WHERE key=? AND ${currentAdminSession}`)
    .bind(enabled ? 1 : 0, now, actor.userId, key, actor.userId, actor.sessionToken, new Date(now).toISOString()).run()
  if (!result.meta.changes) throw new HttpError(404, 'not_found')
}

export async function adminCachePlan(db: D1Database, actor: AdminActor, id: string, plan: string) {
  const result = await db.prepare(`UPDATE caches SET plan=? WHERE id=? AND join_secret IS NOT NULL
    AND EXISTS(SELECT 1 FROM plan_limits WHERE plan=?) AND ${currentAdminSession}`)
    .bind(plan, id, plan, actor.userId, actor.sessionToken, new Date().toISOString()).run()
  if (!result.meta.changes) throw new HttpError(404, 'not_found')
}

export async function adminUserPlan(db: D1Database, actor: AdminActor, id: string, plan: string) {
  const result = await db.prepare(`UPDATE user SET plan=? WHERE id=?
    AND EXISTS(SELECT 1 FROM plan_limits WHERE plan=?) AND ${currentAdminSession}`)
    .bind(plan, id, plan, actor.userId, actor.sessionToken, new Date().toISOString()).run()
  if (!result.meta.changes) throw new HttpError(404, 'not_found')
}
