export type Profile = { id: string; email: string; display_name: string | null }

export function getProfile(db: D1Database, userId: string) {
  return db.prepare('SELECT id, email, display_name FROM user WHERE id = ?').bind(userId).first<Profile>()
}

export async function setDisplayName(db: D1Database, userId: string, name: string) {
  await db.prepare('UPDATE user SET display_name = ?, updatedAt = ? WHERE id = ?')
    .bind(name, new Date().toISOString(), userId).run()
  return getProfile(db, userId)
}
