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
  return db.prepare('SELECT c.id, c.name FROM caches c JOIN my_caches m ON m.cache_id = c.id WHERE m.user_id = ? ORDER BY c.created_at DESC, c.id')
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
    result = await db.prepare('INSERT INTO caches(id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name')
      .bind(data.cache_id, data.name, data.created_at).run()
  } else if (kind === 'discovery_upsert') {
    result = await db.prepare('INSERT OR IGNORE INTO my_caches(user_id, cache_id) VALUES (?, ?)').bind(data.user_id, data.cache_id).run()
  } else if (kind === 'notification') {
    if (!intentId || createdAt === undefined) throw new Error('Missing notification intent identity')
    // Replay must not reset attempts, claims or terminal state.
    result = await db.prepare('INSERT OR IGNORE INTO outbox(id, kind, dedupe_key, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(intentId, data.event, intentId, payload, createdAt).run()
  } else { throw new Error('Unsupported cache sync intent') }
  if (!result.success) throw new Error('Cache projection sync failed')
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

export function syncCursor(db: D1Database) {
  return db.prepare('SELECT cache_id FROM cache_sync_cursor WHERE singleton = 1').first<string | null>('cache_id')
}

export function registryPage(db: D1Database, cursor: string | null) {
  return db.prepare('SELECT id FROM caches WHERE (? IS NULL OR id > ?) ORDER BY id LIMIT 25').bind(cursor, cursor).all<{ id: string }>()
}

export function advanceSyncCursor(db: D1Database, previous: string | null, next: string | null) {
  return db.prepare('UPDATE cache_sync_cursor SET cache_id = ? WHERE singleton = 1 AND cache_id IS ?').bind(next, previous).run()
}
