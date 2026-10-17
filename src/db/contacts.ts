// Self-managed contact settings and approved-request party reveal.
import { HttpError } from '../http'
import { contactInput, type Contact } from '../contacts'

export async function ownContact(db: D1Database, userId: string) {
  const row = await db.prepare('SELECT kind,value FROM user_contacts WHERE user_id=?').bind(userId).first<{kind:string;value:string}>()
  return row ? contactInput(row) : null
}

export async function saveContact(db: D1Database, userId: string, contact: Contact) {
  const result = await db.prepare(`INSERT INTO user_contacts(user_id,kind,value) SELECT id,?,? FROM user WHERE id=?
    ON CONFLICT(user_id) DO UPDATE SET kind=excluded.kind,value=excluded.value`).bind(contact.kind,contact.value,userId).run()
  if (!result.meta.changes) throw new HttpError(404, 'not_found')
}

export function removeContact(db: D1Database, userId: string) {
  return db.prepare('DELETE FROM user_contacts WHERE user_id=?').bind(userId).run()
}

export async function requestContact(db: D1Database, requestId: string, userId: string) {
  // The LEFT JOIN distinguishes an eligible party with no contact from a denied read.
  const row = await db.prepare(`SELECT contact.kind,contact.value FROM requests r
    JOIN items i ON i.id=r.item_id JOIN caches c ON c.id=r.cache_id AND c.join_secret IS NOT NULL
    JOIN memberships requester ON requester.cache_id=r.cache_id AND requester.user_id=r.requester_id AND requester.status='active'
    JOIN memberships owner ON owner.cache_id=r.cache_id AND owner.user_id=i.owner_id AND owner.status='active'
    LEFT JOIN user_contacts contact ON contact.user_id=CASE WHEN r.requester_id=? THEN i.owner_id ELSE r.requester_id END
    WHERE r.id=? AND r.status='approved' AND (r.requester_id=? OR i.owner_id=?)`)
    .bind(userId,requestId,userId,userId).first<{kind:string|null;value:string|null}>()
  if (!row) throw new HttpError(404, 'not_found')
  return row.kind && row.value ? contactInput({kind:row.kind,value:row.value}) : null
}
