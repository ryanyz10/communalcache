import { HttpError } from './http'
import type { ItemChanges } from './items'
import type { DecisionInput } from './requests'

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
      AND NOT EXISTS(SELECT 1 FROM memberships WHERE cache_id=c.id AND user_id=? AND status<>'left')
      ON CONFLICT(cache_id,user_id) DO UPDATE SET status=excluded.status,created_at=excluded.created_at,operation_token=excluded.operation_token
      WHERE memberships.status='left'`)
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
  const result = membership.results[0] as { cache_id: string; name: string; status: 'active' | 'pending' | 'removed' | 'left' } | undefined
  if (!result || result.status === 'left') throw new HttpError(404, 'not_found')
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

type ItemRow = {
  id: string; owner_id: string; owner_name: string | null; title: string; description: string | null
  photo_path: string | null; is_consumable: number; quantity: number | null; available_quantity: number | null; available: number
  unavailable_note: string | null; created_at: number
}

function itemInfo(row: ItemRow, cacheId: string | null) {
  const { photo_path, ...item } = row
  return { ...item, cache_id: cacheId, is_consumable: row.is_consumable === 1, available: row.available === 1, photo_version: photo_path?.split('/').at(-1) ?? null }
}

const itemRead = `SELECT i.id,i.owner_id,i.title,i.description,i.photo_path,i.is_consumable,i.quantity,
  i.available,i.unavailable_note,i.created_at,u.display_name AS owner_name,
  CASE WHEN i.is_consumable=1 THEN i.quantity-(SELECT COALESCE(SUM(quantity),0) FROM requests WHERE item_id=i.id AND status='pending') ELSE NULL END AS available_quantity
  FROM items i JOIN user u ON u.id=i.owner_id`
const itemAccess = `(? IS NULL AND i.owner_id=?) OR EXISTS(
  SELECT 1 FROM item_caches a JOIN caches c ON c.id=a.cache_id AND c.join_secret IS NOT NULL
  JOIN memberships caller ON caller.cache_id=c.id AND caller.user_id=? AND caller.status='active'
  JOIN memberships owner ON owner.cache_id=c.id AND owner.user_id=i.owner_id AND owner.status='active'
  WHERE a.item_id=i.id AND a.cache_id=?)`

type LibraryRow = ItemRow & { caches_json: string; pending_count: number }
const libraryRead = `SELECT library.*,
  (SELECT json_group_array(json_object('id',c.id,'name',c.name)) FROM item_caches a
    JOIN caches c ON c.id=a.cache_id AND c.join_secret IS NOT NULL
    JOIN memberships m ON m.cache_id=c.id AND m.user_id=library.owner_id AND m.status='active'
    WHERE a.item_id=library.id) AS caches_json,
  (SELECT COUNT(*) FROM requests WHERE item_id=library.id AND status='pending') AS pending_count
  FROM (${itemRead} WHERE i.owner_id=?) library`

function libraryItemInfo(row: LibraryRow) {
  const { caches_json, pending_count, ...item } = row
  const caches = JSON.parse(caches_json) as { id: string; name: string }[]
  caches.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return { ...itemInfo(item, null), caches, pending_count }
}

export async function libraryItems(db: D1Database, userId: string) {
  const rows = await db.prepare(`${libraryRead} ORDER BY library.created_at DESC,library.id DESC`).bind(userId).all<LibraryRow>()
  return rows.results.map(libraryItemInfo)
}

export async function libraryPage(db: D1Database, userId: string, after: string | null) {
  let time: number | null = null, id: string | null = null
  if (after !== null) {
    const match = after.match(/^([0-9]{1,16})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw new HttpError(400, 'invalid_cursor')
    time = Number(match[1]); id = match[2].toLowerCase()
  }
  const rows = (await db.prepare(`${libraryRead}
    WHERE (? IS NULL OR library.created_at<? OR (library.created_at=? AND library.id<?))
    ORDER BY library.created_at DESC,library.id DESC LIMIT 26`).bind(userId,time,time,time,id).all<LibraryRow>()).results
  const items = rows.slice(0,25).map(libraryItemInfo), last = items.at(-1)
  return { items, next_cursor: rows.length > 25 ? `${last!.created_at}.${last!.id}` : null }
}

export async function cacheItems(db: D1Database, cacheId: string, userId: string) {
  const [cache, items] = await db.batch([
    db.prepare(cacheRead).bind(userId, cacheId),
    db.prepare(`${itemRead} WHERE ${itemAccess} ORDER BY i.created_at DESC,i.id`).bind(cacheId, userId, userId, cacheId),
  ])
  if (!cache.results.length) throw new HttpError(404, 'not_found')
  return (items.results as ItemRow[]).map(row => itemInfo(row, cacheId))
}

export async function readItem(db: D1Database, itemId: string, userId: string, cacheId: string | null = null, ownerOnly = false) {
  const row = await db.prepare(`${itemRead} WHERE i.id=? AND (?=0 OR i.owner_id=?) AND (${itemAccess})`)
    .bind(itemId, ownerOnly ? 1 : 0, userId, cacheId, userId, userId, cacheId).first<ItemRow>()
  if (!row) throw new HttpError(404, 'not_found')
  return row
}

export async function itemDetail(db: D1Database, itemId: string, userId: string, cacheId: string | null = null) {
  if (cacheId !== null) return itemInfo(await readItem(db, itemId, userId, cacheId), cacheId)
  const row = await db.prepare(`${libraryRead} WHERE library.id=?`).bind(userId,itemId).first<LibraryRow>()
  if (!row) throw new HttpError(404, 'not_found')
  return libraryItemInfo(row)
}

export async function createItem(db: D1Database, userId: string, changes: ItemChanges, cacheId: string | null = null) {
  const id = crypto.randomUUID(), token = crypto.randomUUID(), now = Date.now()
  const [created] = await db.batch([
    db.prepare(`INSERT INTO items(id,owner_id,title,description,is_consumable,quantity,available,unavailable_note,created_at,operation_token)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE ? IS NULL OR EXISTS(
        SELECT 1 FROM memberships m JOIN caches c ON c.id=m.cache_id AND c.join_secret IS NOT NULL
        WHERE m.cache_id=? AND m.user_id=? AND m.status='active')`)
      .bind(id, userId, changes.title!, changes.description ?? null, changes.is_consumable ? 1 : 0, changes.quantity ?? null, changes.available === false ? 0 : 1, changes.unavailable_note ?? null, now, token, cacheId, cacheId, userId),
    db.prepare(`INSERT INTO item_caches(item_id,cache_id,attached_at)
      SELECT id,?,? FROM items WHERE id=? AND owner_id=? AND operation_token=? AND ? IS NOT NULL`)
      .bind(cacheId, now, id, userId, token, cacheId),
  ])
  if (created.meta.changes === 0) throw new HttpError(404, 'not_found')
  return itemDetail(db, id, userId, cacheId)
}

export async function attachItem(db: D1Database, itemId: string, cacheId: string, userId: string) {
  const result = await db.prepare(`INSERT INTO item_caches(item_id,cache_id,attached_at)
    SELECT i.id,m.cache_id,? FROM items i JOIN memberships m ON m.user_id=i.owner_id AND m.status='active'
    JOIN caches c ON c.id=m.cache_id AND c.join_secret IS NOT NULL
    WHERE i.id=? AND i.owner_id=? AND m.cache_id=?
    ON CONFLICT(item_id,cache_id) DO UPDATE SET attached_at=item_caches.attached_at`)
    .bind(Date.now(), itemId, userId, cacheId).run()
  if (result.meta.changes === 0) throw new HttpError(404, 'not_found')
}

export async function updateItem(db: D1Database, itemId: string, userId: string, changes: ItemChanges, cacheId: string | null = null) {
  const token = crypto.randomUUID()
  const result = await db.prepare(`UPDATE items AS i SET title=COALESCE(?,title),
    description=CASE WHEN ? THEN ? ELSE description END,quantity=CASE WHEN ? THEN ? ELSE quantity END,
    available=COALESCE(?,available),unavailable_note=CASE WHEN ? THEN ? ELSE unavailable_note END,operation_token=?
    WHERE i.id=? AND i.owner_id=? AND (${itemAccess}) AND (?=0 OR i.is_consumable=(? IS NOT NULL))
    AND (?=0 OR ? IS NULL OR ?>=(SELECT COALESCE(SUM(quantity),0) FROM requests WHERE item_id=i.id AND status='pending'))`)
    .bind(changes.title ?? null, changes.description !== undefined ? 1 : 0, changes.description ?? null,
      changes.quantity !== undefined ? 1 : 0, changes.quantity ?? null, changes.available === undefined ? null : changes.available ? 1 : 0,
      changes.unavailable_note !== undefined ? 1 : 0, changes.unavailable_note ?? null, token, itemId, userId,
      cacheId, userId, userId, cacheId, changes.quantity !== undefined ? 1 : 0, changes.quantity ?? null,
      changes.quantity !== undefined ? 1 : 0, changes.quantity ?? null, changes.quantity ?? null).run()
  if (result.meta.changes === 0) {
    const item = await readItem(db, itemId, userId, cacheId, true)
    if (changes.quantity !== undefined && (item.is_consumable === 1) !== (changes.quantity !== null)) throw new HttpError(400, 'invalid_quantity')
    throw new HttpError(409, 'quantity_reserved')
  }
  return itemDetail(db, itemId, userId, cacheId)
}

export type D1Request = {
  id: string; item_id: string; cache_id: string; cache_name: string; item_title: string
  owner_id: string; owner_name: string | null; requester_id: string; requester_name: string | null
  quantity: number | null; status: 'pending' | 'approved' | 'rejected'; decision_reason: string | null
  decided_at: number | null; created_at: number
}

const requestRead = `SELECT r.id AS id,r.item_id,r.cache_id,c.name AS cache_name,i.title AS item_title,
  i.owner_id,owner.display_name AS owner_name,r.requester_id,requester.display_name AS requester_name,
  r.quantity,r.status,r.decision_reason,r.decided_at,r.created_at AS created_at FROM requests r
  JOIN items i ON i.id=r.item_id JOIN caches c ON c.id=r.cache_id
  JOIN user owner ON owner.id=i.owner_id JOIN user requester ON requester.id=r.requester_id`
const requestContext = `EXISTS(SELECT 1 FROM item_caches a JOIN caches config ON config.id=a.cache_id AND config.join_secret IS NOT NULL
  JOIN memberships requester ON requester.cache_id=a.cache_id AND requester.user_id=r.requester_id AND requester.status='active'
  JOIN memberships owner ON owner.cache_id=a.cache_id AND owner.user_id=i.owner_id AND owner.status='active'
  WHERE a.item_id=r.item_id AND a.cache_id=r.cache_id)`

export async function createRequest(db: D1Database, itemId: string, cacheId: string, userId: string, quantity: number | null) {
  // Bound JS integers can be REAL in SQLite; integer equality avoids relying on parameter typeof().
  const id = crypto.randomUUID(), token = crypto.randomUUID(), now = Date.now()
  const [created, _outbox, result] = await db.batch([
    db.prepare(`INSERT INTO requests(id,item_id,cache_id,requester_id,quantity,status,created_at,creation_token)
      SELECT ?,i.id,?,?,?,'pending',?,? FROM items i JOIN item_caches a ON a.item_id=i.id AND a.cache_id=?
      JOIN caches c ON c.id=a.cache_id AND c.join_secret IS NOT NULL
      JOIN memberships caller ON caller.cache_id=c.id AND caller.user_id=? AND caller.status='active'
      JOIN memberships owner ON owner.cache_id=c.id AND owner.user_id=i.owner_id AND owner.status='active'
      WHERE i.id=? AND i.owner_id<>? AND i.available=1 AND ((i.is_consumable=0 AND ? IS NULL)
        OR (i.is_consumable=1 AND ? BETWEEN 1 AND 9999 AND ?=CAST(? AS INTEGER)
          AND i.quantity-(SELECT COALESCE(SUM(quantity),0) FROM requests WHERE item_id=i.id AND status='pending')>=?))`)
      .bind(id,cacheId,userId,quantity,now,token,cacheId,userId,itemId,userId,quantity,quantity,quantity,quantity,quantity),
    db.prepare(`INSERT INTO outbox(id,kind,dedupe_key,payload,created_at)
      SELECT ?,'request_created',?,json_object('event','request_created','cache_id',c.id,'cache_name',c.name,
        'item_id',i.id,'item_title',i.title,'request_id',r.id,'recipient_id',i.owner_id,'user_id',r.requester_id,'quantity',r.quantity),?
      FROM requests r JOIN items i ON i.id=r.item_id JOIN caches c ON c.id=r.cache_id WHERE r.id=? AND r.creation_token=?`)
      .bind(token,token,now,id,token),
    db.prepare(`${requestRead} WHERE r.id=? AND r.creation_token=?`).bind(id,token),
  ])
  if (created.meta.changes === 0) {
    const item = await readItem(db,itemId,userId,cacheId)
    if (item.owner_id === userId) throw new HttpError(404,'not_found')
    if ((item.is_consumable === 1) !== (quantity !== null) || (quantity !== null && (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999))) throw new HttpError(400,'invalid_request_quantity')
    throw new HttpError(409,item.available ? 'insufficient_stock' : 'item_unavailable')
  }
  return { request: result.results[0] as D1Request, notificationId: token }
}

export async function itemRequests(db: D1Database, itemId: string, cacheId: string, userId: string) {
  const [item, requests] = await db.batch([
    db.prepare(`${itemRead} WHERE i.id=? AND (${itemAccess})`).bind(itemId,cacheId,userId,userId,cacheId),
    db.prepare(`${requestRead} WHERE r.item_id=? AND r.cache_id=? AND (${itemAccess})
      AND (r.status='pending' OR r.requester_id=? OR i.owner_id=?) ORDER BY r.created_at DESC,r.id DESC`)
      .bind(itemId,cacheId,cacheId,userId,userId,cacheId,userId,userId),
  ])
  if (!item.results.length) throw new HttpError(404,'not_found')
  return requests.results as D1Request[]
}

export async function decideRequest(db: D1Database, requestId: string, userId: string, action: 'approve' | 'reject', input: DecisionInput, cacheId: string | null = null) {
  const token = crypto.randomUUID(), now = Date.now(), status = action === 'approve' ? 'approved' : 'rejected', event = `request_${status}`
  const markLentOut = action === 'approve' && input.mark_lent_out
  const [decided, _stock, _availability, _outbox, result] = await db.batch([
    db.prepare(`UPDATE requests AS r SET status=?,decision_reason=?,decided_at=?,decision_token=?
      WHERE r.id=? AND r.status='pending' AND (? IS NULL OR r.cache_id=?)
      AND EXISTS(SELECT 1 FROM items i WHERE i.id=r.item_id AND i.owner_id=? AND ${requestContext}
        AND (?=0 OR i.is_consumable=0) AND (?=0 OR i.is_consumable=0 OR i.quantity>=r.quantity))`)
      .bind(status,input.reason,now,token,requestId,cacheId,cacheId,userId,markLentOut ? 1 : 0,action === 'approve' ? 1 : 0),
    db.prepare(`UPDATE items SET quantity=quantity-(SELECT quantity FROM requests WHERE id=? AND decision_token=?)
      WHERE id=(SELECT item_id FROM requests WHERE id=? AND decision_token=?) AND is_consumable=1 AND ?=1`)
      .bind(requestId,token,requestId,token,action === 'approve' ? 1 : 0),
    db.prepare(`UPDATE items SET available=0,unavailable_note=CASE WHEN ? THEN ? ELSE unavailable_note END
      WHERE id=(SELECT item_id FROM requests WHERE id=? AND decision_token=?) AND is_consumable=0 AND ?=1`)
      .bind(input.unavailable_note !== undefined ? 1 : 0,input.unavailable_note ?? null,requestId,token,markLentOut ? 1 : 0),
    db.prepare(`INSERT INTO outbox(id,kind,dedupe_key,payload,created_at)
      SELECT ?,?,?,json_object('event',?,'cache_id',c.id,'cache_name',c.name,'item_id',i.id,'item_title',i.title,
        'request_id',r.id,'recipient_id',r.requester_id,'user_id',i.owner_id,'quantity',r.quantity,'reason',r.decision_reason),?
      FROM requests r JOIN items i ON i.id=r.item_id JOIN caches c ON c.id=r.cache_id WHERE r.id=? AND r.decision_token=?`)
      .bind(token,event,token,event,now,requestId,token),
    db.prepare(`${requestRead} WHERE r.id=? AND r.decision_token=?`).bind(requestId,token),
  ])
  if (decided.meta.changes === 0) {
    const request = await db.prepare(`${requestRead} WHERE r.id=? AND i.owner_id=? AND (? IS NULL OR r.cache_id=?) AND ${requestContext}`)
      .bind(requestId,userId,cacheId,cacheId).first<D1Request>()
    if (!request) throw new HttpError(404,'not_found')
    if (request.status !== 'pending') throw new HttpError(409,'request_not_pending')
    if (markLentOut && request.quantity !== null) throw new HttpError(400,'invalid_lent_out')
    throw new HttpError(409,'insufficient_stock')
  }
  return { request: result.results[0] as D1Request, notificationId: token }
}

export async function requestsPage(db: D1Database, userId: string, after: string | null) {
  let time: number | null = null, id: string | null = null
  if (after !== null) {
    const match = after.match(/^([0-9]{1,16})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw new HttpError(400,'invalid_cursor')
    time = Number(match[1]); id = match[2].toLowerCase()
  }
  const cursor = '(? IS NULL OR r.created_at<? OR (r.created_at=? AND r.id<?))'
  const rows = (await db.prepare(`${requestRead} WHERE i.owner_id=? AND ${cursor}
    UNION ${requestRead} WHERE r.requester_id=? AND ${cursor} ORDER BY created_at DESC,id DESC LIMIT 26`)
    .bind(userId,time,time,time,id,userId,time,time,time,id).all<D1Request>()).results
  const requests = rows.slice(0,25), last = requests.at(-1)
  return { requests, unavailable_cache_ids: [], next_cursor: rows.length > 25 ? `${last!.created_at}.${last!.id}` : null }
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

export async function deleteItem(db: D1Database, itemId: string, userId: string, cacheId: string | null = null) {
  const token = crypto.randomUUID(), now = Date.now()
  const witness = `EXISTS(SELECT 1 FROM items i WHERE i.id=? AND i.owner_id=? AND i.operation_token=?)`
  const [deleted, _outbox, _requests, _exact, _prefix, hints] = await db.batch([
    db.prepare(`UPDATE items AS i SET operation_token=? WHERE i.id=? AND i.owner_id=? AND (${itemAccess})`)
      .bind(token,itemId,userId,cacheId,userId,userId,cacheId),
    db.prepare(`INSERT INTO outbox(id,kind,dedupe_key,payload,created_at)
      SELECT r.id,'item_deleted',?||':'||r.id,json_object('event','item_deleted','cache_id',c.id,'cache_name',c.name,
        'item_id',i.id,'item_title',i.title,'request_id',r.id,'recipient_id',r.requester_id,'user_id',?,'quantity',r.quantity,'reason','item deleted'),?
      FROM requests r JOIN items i ON i.id=r.item_id JOIN caches c ON c.id=r.cache_id
      WHERE i.id=? AND i.owner_id=? AND i.operation_token=? AND r.status='pending'`).bind(token,userId,now,itemId,userId,token),
    db.prepare(`UPDATE requests SET status='rejected',decision_reason='item deleted',decided_at=?,decision_token=?
      WHERE item_id=? AND status='pending' AND ${witness}`).bind(now,token,itemId,itemId,userId,token),
    db.prepare(`INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at)
      SELECT ?,owner_id,id,'exact',photo_path,? FROM items WHERE id=? AND owner_id=? AND operation_token=? AND photo_path IS NOT NULL
      ON CONFLICT(kind,target) DO NOTHING`).bind(crypto.randomUUID(),now,itemId,userId,token),
    db.prepare(`INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at)
      SELECT ?,owner_id,id,'prefix',owner_id||'/'||id||'/',? FROM items WHERE id=? AND owner_id=? AND operation_token=?
      ON CONFLICT(kind,target) DO NOTHING`).bind(crypto.randomUUID(),now,itemId,userId,token),
    db.prepare(`SELECT id FROM outbox WHERE kind='item_deleted' AND dedupe_key>=? AND dedupe_key<? AND ${witness} ORDER BY dedupe_key LIMIT 25`)
      .bind(`${token}:`,`${token};`,itemId,userId,token),
    db.prepare('DELETE FROM items WHERE id=? AND owner_id=? AND operation_token=?').bind(itemId,userId,token),
  ])
  if (deleted.meta.changes === 0) throw new HttpError(404,'not_found')
  return (hints.results as {id:string}[]).map(row=>row.id)
}

export async function finishItemPhoto(db: D1Database, itemId: string, userId: string, key: string, uploaded: boolean, cacheId: string | null = null) {
  const prefix = `${userId}/${itemId}/`
  if (!key.startsWith(prefix) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key.slice(prefix.length))) throw new HttpError(404, 'not_found')
  const token = crypto.randomUUID(), now = Date.now()
  const [marked] = await db.batch([
    db.prepare(`UPDATE items AS i SET operation_token=? WHERE i.id=? AND i.owner_id=? AND ?=1 AND (${itemAccess})
      AND NOT EXISTS(SELECT 1 FROM r2_cleanup WHERE (kind='exact' AND target=?) OR (kind='prefix' AND substr(?,1,length(target))=target))`)
      .bind(token, itemId, userId, uploaded ? 1 : 0, cacheId, userId, userId, cacheId, key, key),
    db.prepare(`INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at)
      SELECT ?,owner_id,id,'exact',photo_path,? FROM items WHERE id=? AND owner_id=? AND operation_token=? AND photo_path IS NOT NULL AND photo_path<>?
      ON CONFLICT(kind,target) DO NOTHING`).bind(crypto.randomUUID(), now, itemId, userId, token, key),
    db.prepare('UPDATE items SET photo_path=? WHERE id=? AND owner_id=? AND operation_token=?').bind(key, itemId, userId, token),
  ])
  if (marked.meta.changes === 0) {
    // Independent guarded repair for bytes already written, not a grant from the failed mutation.
    await db.prepare(`INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at)
      SELECT ?,?,?,'exact',?,? WHERE NOT EXISTS(SELECT 1 FROM items WHERE photo_path=?)
      ON CONFLICT(kind,target) DO NOTHING`).bind(crypto.randomUUID(), userId, itemId, key, now, key).run()
  }
  return marked.meta.changes > 0
}

export type CleanupRow = { id: string; owner_id: string; item_id: string; kind: 'exact' | 'prefix'; target: string; created_at: number }

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
    RETURNING id,owner_id,item_id,kind,target,created_at`).bind(token, now + 90_000, id, now).all<CleanupRow>()
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

export function syncCursor(db: D1Database) {
  return db.prepare('SELECT cache_id FROM cache_sync_cursor WHERE singleton = 1').first<string | null>('cache_id')
}

export function registryPage(db: D1Database, cursor: string | null) {
  return db.prepare('SELECT id FROM caches WHERE join_secret IS NULL AND (? IS NULL OR id > ?) ORDER BY id LIMIT 25').bind(cursor, cursor).all<{ id: string }>()
}

export function advanceSyncCursor(db: D1Database, previous: string | null, next: string | null) {
  return db.prepare('UPDATE cache_sync_cursor SET cache_id = ? WHERE singleton = 1 AND cache_id IS ?').bind(next, previous).run()
}
