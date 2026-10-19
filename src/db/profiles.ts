// Profiles and current-authority avatar metadata enrichment.
import { HttpError } from '../http'
import type { CatCoat } from '../../shared/cat-coats'
import { profilePhotoAccess } from './shared'

export type Profile = { id: string; email: string; display_name: string | null; cat_coat?: CatCoat | null; tour_completed_at?: number | null; profile_photo_version?: string | null }

export function photoVersion(key: string | null) { return key?.split('/').at(-1) ?? null }

export async function getProfile(db: D1Database, userId: string) {
  const row = await db.prepare(`SELECT u.id,u.email,u.display_name,u.cat_coat,u.tour_completed_at,p.photo_path FROM user u
    LEFT JOIN user_photos p ON p.user_id=u.id WHERE u.id=?`).bind(userId)
    .first<{id:string;email:string;display_name:string|null;cat_coat:CatCoat|null;tour_completed_at:number|null;photo_path:string|null}>()
  if (!row) return null
  const {photo_path,...profile} = row
  return {...profile,profile_photo_version:photoVersion(photo_path)}
}

export async function profilePhotoVersions(db: D1Database, readerId: string, userIds: string[]) {
  if (!userIds.length) return new Map<string,string|null>()
  const rows = await db.prepare(`SELECT u.id,p.photo_path FROM user u JOIN user_photos p ON p.user_id=u.id
    WHERE u.id IN(SELECT value FROM json_each(?)) AND (${profilePhotoAccess})`)
    .bind(JSON.stringify([...new Set(userIds)]),readerId,readerId).all<{id:string;photo_path:string}>()
  return new Map(rows.results.map(row=>[row.id,photoVersion(row.photo_path)]))
}

export async function updateProfile(db: D1Database, userId: string, changes: { display_name?: string; cat_coat?: CatCoat | null; tour_completed?: boolean }) {
  const updated = await db.prepare(`UPDATE user SET
    display_name=CASE WHEN ? THEN ? ELSE display_name END,
    cat_coat=CASE WHEN ? THEN ? ELSE cat_coat END,
    tour_completed_at=CASE WHEN ? THEN ? ELSE tour_completed_at END,updatedAt=? WHERE id=?`)
    .bind(changes.display_name !== undefined ? 1 : 0,changes.display_name ?? null,
      changes.cat_coat !== undefined ? 1 : 0,changes.cat_coat ?? null,
      changes.tour_completed !== undefined ? 1 : 0,changes.tour_completed ? Date.now() : null,
      new Date().toISOString(),userId).run()
  if (!updated.meta.changes) throw new HttpError(404,'not_found')
  return getProfile(db, userId)
}

export function setDisplayName(db: D1Database, userId: string, name: string) {
  return updateProfile(db,userId,{display_name:name})
}
