// Write budgets and same-statement plan quota diagnostics.
import { HttpError } from '../http'

export function consumeWriteLimit(db: D1Database, userId: string, route: string, windowStart: number, limit: number) {
  // The guarded UPSERT is one atomic D1 statement, including concurrent Worker attempts.
  return db.prepare(`INSERT INTO write_limits(user_id,route,window_start,count) VALUES (?, ?, ?, 1)
    ON CONFLICT(user_id,route) DO UPDATE SET window_start=excluded.window_start,
      count=CASE WHEN write_limits.window_start < excluded.window_start THEN 1 ELSE write_limits.count + 1 END
    WHERE write_limits.window_start < excluded.window_start
      OR (write_limits.window_start = excluded.window_start AND write_limits.count < ?)`)
    .bind(userId, route, windowStart, limit).run()
}

export const ownedCacheCount = `(SELECT COUNT(*) FROM memberships m JOIN caches owned ON owned.id=m.cache_id
  WHERE m.user_id=u.id AND m.role='owner' AND m.status='active' AND owned.join_secret IS NOT NULL)`
export const memberCacheCount = `(SELECT COUNT(*) FROM memberships m JOIN caches joined ON joined.id=m.cache_id
  WHERE m.user_id=u.id AND m.status='active' AND joined.join_secret IS NOT NULL)`
export const cacheMemberCount = `(SELECT COUNT(*) FROM memberships WHERE cache_id=c.id AND status='active')`
export const ownedItemCount = `(SELECT COUNT(*) FROM items WHERE owner_id=u.id)`
export const openRequestCount = `(SELECT COUNT(*) FROM requests WHERE requester_id=u.id AND status='pending')`
export const membershipQuotaRead = `${memberCacheCount} AS member_used,ul.member_caches AS member_limit,
  ${cacheMemberCount} AS cache_used,cl.cache_members AS cache_limit`
export type MembershipQuota = { member_used: number; member_limit: number | null; cache_used: number; cache_limit: number | null }

export function checkQuota(limit: string, used: number, maximum: number | null) {
  if (maximum === null) throw new HttpError(503,'limits_unavailable')
  if (used >= maximum) throw new HttpError(409,'limit_reached',undefined,limit)
}
export function checkMembershipQuota(row: MembershipQuota) {
  checkQuota('member_caches',row.member_used,row.member_limit)
  checkQuota('cache_members',row.cache_used,row.cache_limit)
}
