// Push registration ownership and stale-registration protection.
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
