// Read fresh D1 policy; a missing switch never enables a feature.
export async function featureEnabled(db: D1Database, key: string) {
  return await db.prepare('SELECT enabled FROM feature_flags WHERE key=?').bind(key).first<number>('enabled') === 1
}
