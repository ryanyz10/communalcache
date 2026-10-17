// Notification delivery claims, terminal writes and bounded rescue cursors.
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
