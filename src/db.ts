import { HttpError } from './http'

export function consumeWriteLimit(db: D1Database, userId: string, route: string, windowStart: number, limit: number) {
  // The guarded UPSERT is one atomic D1 statement, including concurrent Worker attempts.
  return db.prepare(`INSERT INTO write_limits(user_id,route,window_start,count) VALUES (?, ?, ?, 1)
    ON CONFLICT(user_id,route) DO UPDATE SET window_start=excluded.window_start,
      count=CASE WHEN write_limits.window_start < excluded.window_start THEN 1 ELSE write_limits.count + 1 END
    WHERE write_limits.window_start < excluded.window_start
      OR (write_limits.window_start = excluded.window_start AND write_limits.count < ?)`)
    .bind(userId, route, windowStart, limit).run()
}

export type Profile = { id: string; email: string; display_name: string | null }

export function getProfile(db: D1Database, userId: string) {
  return db.prepare('SELECT id, email, display_name FROM user WHERE id = ?').bind(userId).first<Profile>()
}

export async function setDisplayName(db: D1Database, userId: string, name: string) {
  await db.prepare('UPDATE user SET display_name = ?, updatedAt = ? WHERE id = ?')
    .bind(name, new Date().toISOString(), userId).run()
  return getProfile(db, userId)
}

export function listMyCaches(db: D1Database, userId: string) {
  return db.prepare(`SELECT c.id, c.name FROM caches c JOIN memberships m ON m.cache_id = c.id WHERE m.user_id = ? AND m.status = 'active' AND c.join_secret IS NOT NULL ORDER BY c.created_at DESC, c.id`)
    .bind(userId).all<{ id: string; name: string }>()
}

export function requestCachePage(db: D1Database, userId: string, after: string | null) {
  return db.prepare('SELECT cache_id FROM my_caches WHERE user_id = ? AND (? IS NULL OR cache_id > ?) ORDER BY cache_id LIMIT 26')
    .bind(userId, after, after).all<{ cache_id: string }>()
}

export async function displayNames(db: D1Database, userIds: string[]) {
  // Bound pages keep each query small; no email is selected for public enrichment.
  const names = new Map<string, string | null>()
  for (let offset = 0; offset < userIds.length; offset += 100) {
    const ids = userIds.slice(offset, offset + 100)
    const rows = await db.prepare(`SELECT id, display_name FROM user WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string; display_name: string | null }>()
    for (const row of rows.results) names.set(row.id, row.display_name)
  }
  return names
}

export async function applyCacheIntent(db: D1Database, kind: string, payload: string, intentId?: string, createdAt?: number) {
  const data = JSON.parse(payload) as { cache_id: string; name: string; created_at: number; user_id: string; event: string }
  let result: D1Result
  if (kind === 'registry_upsert') {
    result = await db.prepare('INSERT INTO caches(id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name WHERE caches.join_secret IS NULL')
      .bind(data.cache_id, data.name, data.created_at).run()
  } else if (kind === 'discovery_upsert') {
    result = await db.prepare('INSERT OR IGNORE INTO my_caches(user_id, cache_id) VALUES (?, ?)').bind(data.user_id, data.cache_id).run()
  } else if (kind === 'discovery_delete') {
    result = await db.prepare('DELETE FROM my_caches WHERE user_id=? AND cache_id=?').bind(data.user_id, data.cache_id).run()
  } else if (kind === 'notification') {
    if (!intentId || createdAt === undefined) throw new Error('Missing notification intent identity')
    // Replay must not reset attempts, claims or terminal state.
    result = await db.prepare('INSERT OR IGNORE INTO outbox(id, kind, dedupe_key, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(intentId, data.event, intentId, payload, createdAt).run()
  } else { throw new Error('Unsupported cache sync intent') }
  if (!result.success) throw new Error('Cache projection sync failed')
}

export type PushRow = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }

export function savePush(db: D1Database, userId: string, subscription: { endpoint: string; p256dh: string; auth: string }) {
  // ponytail: three browsers/account bounds one delivery row; paginated delivery state is the upgrade path.
  return db.prepare(`INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,created_at)
    SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM push_subscriptions WHERE user_id=?) < 3
      OR EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id=? AND endpoint=?)
    ON CONFLICT(endpoint) DO UPDATE SET id=excluded.id, user_id=excluded.user_id,
      p256dh=excluded.p256dh, auth=excluded.auth, created_at=excluded.created_at`)
    .bind(crypto.randomUUID(), userId, subscription.endpoint, subscription.p256dh, subscription.auth, Date.now(), userId, userId, subscription.endpoint).run()
}

export function deletePush(db: D1Database, userId: string, endpoint: string) {
  return db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').bind(userId, endpoint).run()
}

export function currentPush(db: D1Database, id: string, userId: string) {
  return db.prepare('SELECT 1 FROM push_subscriptions WHERE id=? AND user_id=?').bind(id, userId).first<number>()
}

export function removeExpiredPush(db: D1Database, id: string, userId: string) {
  // A 410 for an old registration must not delete a newer subscription/account assignment.
  return db.prepare('DELETE FROM push_subscriptions WHERE id=? AND user_id=?').bind(id, userId).run()
}

export function pushSubscriptions(db: D1Database, userId: string) {
  return db.prepare('SELECT id,user_id,endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=? ORDER BY created_at,id LIMIT 4').bind(userId).all<PushRow>()
}

export type OutboxRow = { id: string; kind: string; payload: string; attempts: number }

export async function claimOutbox(db: D1Database, id: string, token: string, now: number) {
  const result = await db.prepare(`UPDATE outbox SET attempts = attempts + 1, claim_token = ?, claim_until = ?
    WHERE id = ? AND sent_at IS NULL AND failed_at IS NULL AND (claim_until IS NULL OR claim_until <= ?)
    RETURNING id, kind, payload, attempts`).bind(token, now + 90_000, id, now).all<OutboxRow>()
  return result.meta.changes === 0 ? null : result.results[0]
}

export function notificationEmail(db: D1Database, userId: string) {
  return db.prepare('SELECT email FROM user WHERE id = ? AND emailVerified = 1').bind(userId).first<string>('email')
}

export function markOutboxSent(db: D1Database, id: string, token: string, now: number) {
  return db.prepare(`UPDATE outbox SET sent_at = ?, claim_token = NULL, claim_until = NULL
    WHERE id = ? AND sent_at IS NULL AND failed_at IS NULL AND claim_token = ? AND claim_until > ?`)
    .bind(now, id, token, now).run()
}

export function recordOutboxFailure(db: D1Database, id: string, token: string, now: number, terminal: boolean) {
  return db.prepare(`UPDATE outbox SET failed_at = ?, claim_token = NULL, claim_until = NULL
    WHERE id = ? AND sent_at IS NULL AND failed_at IS NULL AND claim_token = ? AND claim_until > ?`)
    .bind(terminal ? now : null, id, token, now).run()
}

export function notificationCursor(db: D1Database) {
  return db.prepare('SELECT outbox_id FROM notification_sync_cursor WHERE singleton = 1').first<string | null>('outbox_id')
}

export function recoverableOutbox(db: D1Database, after: string | null, now: number) {
  return db.prepare(`SELECT id FROM outbox WHERE sent_at IS NULL AND failed_at IS NULL
    AND created_at <= ? AND (claim_until IS NULL OR claim_until <= ?) AND (? IS NULL OR id > ?)
    ORDER BY id LIMIT 25`).bind(now - 180_000, now, after, after).all<{ id: string }>()
}

export function advanceNotificationCursor(db: D1Database, previous: string | null, next: string | null) {
  return db.prepare('UPDATE notification_sync_cursor SET outbox_id = ? WHERE singleton = 1 AND outbox_id IS ?').bind(next, previous).run()
}

export type CacheInfo = { id: string; name: string; owner_id: string; invite_token: string; requires_approval: boolean }
type CacheRow = { id: string; name: string; owner_id: string; join_secret: string; requires_approval: number }

function cacheInfo(row: CacheRow): CacheInfo {
  return { id: row.id, name: row.name, owner_id: row.owner_id, invite_token: `${row.id}.${row.join_secret}`, requires_approval: row.requires_approval === 1 }
}

function newJoinSecret() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function decodedSecret(secret: string) {
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(secret)) return null
  return Uint8Array.from(atob(secret.replaceAll('-', '+').replaceAll('_', '/') + '='), char => char.charCodeAt(0))
}

const cacheRead = `SELECT c.id,c.name,c.join_secret,c.requires_approval,owner.user_id AS owner_id
  FROM caches c JOIN memberships owner ON owner.cache_id=c.id AND owner.role='owner' AND owner.status='active'
  JOIN memberships caller ON caller.cache_id=c.id AND caller.user_id=? AND caller.status='active'
  WHERE c.id=? AND c.join_secret IS NOT NULL`

export async function createCache(db: D1Database, ownerId: string, name: string, requiresApproval: boolean) {
  const id = crypto.randomUUID(), token = crypto.randomUUID(), secret = newJoinSecret(), now = Date.now()
  const results = await db.batch([
    db.prepare('INSERT INTO caches(id,name,created_at,join_secret,requires_approval,operation_token) VALUES (?,?,?,?,?,?)')
      .bind(id, name, now, secret, requiresApproval ? 1 : 0, token),
    db.prepare(`INSERT INTO memberships(cache_id,user_id,role,status,created_at)
      SELECT id,?,'owner','active',? FROM caches WHERE id=? AND operation_token=?`).bind(ownerId, now, id, token),
  ])
  if (results[0].meta.changes !== 1) throw new Error('Cache creation failed')
  return cacheInfo({ id, name, owner_id: ownerId, join_secret: secret, requires_approval: requiresApproval ? 1 : 0 })
}

export async function cacheDetail(db: D1Database, cacheId: string, userId: string) {
  const [cache, members] = await db.batch([
    db.prepare(cacheRead).bind(userId, cacheId),
    db.prepare(`SELECT m.user_id,u.display_name FROM memberships m JOIN user u ON u.id=m.user_id
      JOIN memberships caller ON caller.cache_id=m.cache_id AND caller.user_id=? AND caller.status='active'
      JOIN caches c ON c.id=m.cache_id AND c.join_secret IS NOT NULL
      WHERE m.cache_id=? AND m.status='active' ORDER BY m.created_at,m.user_id`).bind(userId, cacheId),
  ])
  if (!cache.results.length) throw new HttpError(404, 'not_found')
  return { ...cacheInfo(cache.results[0] as CacheRow), members: members.results as { user_id: string; display_name: string | null }[] }
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

export async function cacheJoinRequests(db: D1Database, cacheId: string, userId: string) {
  const [cache, applicants] = await db.batch([
    db.prepare(`${cacheRead} AND caller.role='owner'`).bind(userId, cacheId),
    db.prepare(`SELECT m.user_id,m.created_at,u.display_name FROM memberships m JOIN user u ON u.id=m.user_id
      JOIN memberships caller ON caller.cache_id=m.cache_id AND caller.user_id=? AND caller.role='owner' AND caller.status='active'
      JOIN caches c ON c.id=m.cache_id AND c.join_secret IS NOT NULL
      WHERE m.cache_id=? AND m.status='pending' ORDER BY m.created_at,m.user_id`).bind(userId, cacheId),
  ])
  if (!cache.results.length) throw new HttpError(404, 'not_found')
  return applicants.results as { user_id: string; created_at: number; display_name: string | null }[]
}

export async function joinCache(db: D1Database, cacheId: string, userId: string, secret: string) {
  const stored = await db.prepare('SELECT join_secret FROM caches WHERE id=? AND join_secret IS NOT NULL').bind(cacheId).first<string>('join_secret')
  const candidate = decodedSecret(secret), expected = stored ? decodedSecret(stored) : null
  if (!candidate || !expected || !crypto.subtle.timingSafeEqual(candidate, expected)) throw new HttpError(404, 'not_found')
  const token = crypto.randomUUID(), now = Date.now()
  const [inserted, outbox, membership] = await db.batch([
    db.prepare(`INSERT INTO memberships(cache_id,user_id,role,status,created_at,operation_token)
      SELECT c.id,?,'member',CASE WHEN c.requires_approval=1 THEN 'pending' ELSE 'active' END,?,? FROM caches c
      WHERE c.id=? AND c.join_secret=?
      AND EXISTS(SELECT 1 FROM memberships WHERE cache_id=c.id AND role='owner' AND status='active')
      AND NOT EXISTS(SELECT 1 FROM memberships WHERE cache_id=c.id AND user_id=?)`)
      .bind(userId, now, token, cacheId, stored, userId),
    db.prepare(`INSERT INTO outbox(id,kind,dedupe_key,payload,created_at)
      SELECT ?,'join_requested',?,json_object('event','join_requested','cache_id',c.id,'cache_name',c.name,'recipient_id',owner.user_id,'user_id',m.user_id),?
      FROM memberships m JOIN caches c ON c.id=m.cache_id
      JOIN memberships owner ON owner.cache_id=c.id AND owner.role='owner' AND owner.status='active'
      WHERE m.cache_id=? AND m.user_id=? AND m.operation_token=? AND m.status='pending'`)
      .bind(token, token, now, cacheId, userId, token),
    db.prepare(`SELECT c.id AS cache_id,c.name,m.status FROM caches c JOIN memberships m ON m.cache_id=c.id AND m.user_id=?
      WHERE c.id=? AND c.join_secret=?`).bind(userId, cacheId, stored),
  ])
  const result = membership.results[0] as { cache_id: string; name: string; status: 'active' | 'pending' | 'removed' } | undefined
  if (!result) throw new HttpError(404, 'not_found')
  if (result.status === 'removed') throw new HttpError(403, 'member_removed')
  // Existing active/pending joins do not emit another notification.
  return { membership: result, notificationId: inserted.meta.changes > 0 && outbox.meta.changes > 0 ? token : null }
}

export async function decideCacheJoin(db: D1Database, cacheId: string, userId: string, applicantId: string, decision: 'approve' | 'reject') {
  const token = crypto.randomUUID(), now = Date.now(), event = decision === 'approve' ? 'join_approved' : 'join_rejected'
  const results = await db.batch([
    db.prepare(`UPDATE memberships SET operation_token=? WHERE cache_id=? AND user_id=? AND status='pending'
      AND EXISTS(SELECT 1 FROM memberships caller JOIN caches c ON c.id=caller.cache_id
        WHERE caller.cache_id=? AND caller.user_id=? AND caller.role='owner' AND caller.status='active' AND c.join_secret IS NOT NULL)`)
      .bind(token, cacheId, applicantId, cacheId, userId),
    db.prepare(`INSERT INTO outbox(id,kind,dedupe_key,payload,created_at)
      SELECT ?,?,?,json_object('event',?,'cache_id',c.id,'cache_name',c.name,'recipient_id',m.user_id,'user_id',m.user_id),?
      FROM memberships m JOIN caches c ON c.id=m.cache_id WHERE m.cache_id=? AND m.user_id=? AND m.operation_token=? AND m.status='pending'`)
      .bind(token, event, token, event, now, cacheId, applicantId, token),
    decision === 'approve'
      ? db.prepare("UPDATE memberships SET status='active' WHERE cache_id=? AND user_id=? AND operation_token=? AND status='pending'").bind(cacheId, applicantId, token)
      : db.prepare("DELETE FROM memberships WHERE cache_id=? AND user_id=? AND operation_token=? AND status='pending'").bind(cacheId, applicantId, token),
  ])
  if (results[0].meta.changes === 0) {
    const authorized = await db.prepare(`${cacheRead} AND caller.role='owner'`).bind(userId, cacheId).first()
    if (!authorized) throw new HttpError(404, 'not_found')
    throw new HttpError(409, 'join_not_pending')
  }
  return { status: decision === 'approve' ? 'active' : 'rejected', notificationId: token }
}

export function syncCursor(db: D1Database) {
  return db.prepare('SELECT cache_id FROM cache_sync_cursor WHERE singleton = 1').first<string | null>('cache_id')
}

export function registryPage(db: D1Database, cursor: string | null) {
  return db.prepare('SELECT id FROM caches WHERE join_secret IS NULL AND (? IS NULL OR id > ?) ORDER BY id LIMIT 25').bind(cursor, cursor).all<{ id: string }>()
}

export function advanceSyncCursor(db: D1Database, previous: string | null, next: string | null) {
  return db.prepare('UPDATE cache_sync_cursor SET cache_id = ? WHERE singleton = 1 AND cache_id IS ?').bind(next, previous).run()
}
