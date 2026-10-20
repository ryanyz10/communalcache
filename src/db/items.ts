// Canonical owner library, cache-visible items, stock edits and global deletion.
import { HttpError } from '../http'
import type { ItemChanges } from '../items'
import type { CatCoat } from '../../shared/cat-coats'
import { checkQuota, ownedItemCount } from './limits'
import { profilePhotoVersions } from './profiles'
import { cacheRead, itemAccess, itemRead } from './shared'

type ItemRow = {
  id: string; owner_id: string; owner_name: string | null; owner_cat_coat: CatCoat | null; title: string; description: string | null
  photo_path: string | null; is_consumable: number; quantity: number | null; available_quantity: number | null; available: number
  created_at: number
}

function itemInfo(row: ItemRow, cacheId: string | null) {
  const { photo_path, ...item } = row
  return { ...item, cache_id: cacheId, is_consumable: row.is_consumable === 1, available: row.available === 1, photo_version: photo_path?.split('/').at(-1) ?? null }
}

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
  const photos = await profilePhotoVersions(db,userId,[userId])
  return rows.results.map(row=>({...libraryItemInfo(row),owner_photo_version:photos.get(row.owner_id) ?? null}))
}

export async function libraryPage(db: D1Database, userId: string, after: string | null, filter = 'all') {
  if (!['all','lend','give','unshared'].includes(filter)) throw new HttpError(400,'invalid_filter')
  let time: number | null = null, id: string | null = null
  if (after !== null) {
    const match = after.match(/^([0-9]{1,16})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw new HttpError(400, 'invalid_cursor')
    time = Number(match[1]); id = match[2].toLowerCase()
  }
  const [page,counts] = await db.batch([
    db.prepare(`${libraryRead}
      WHERE (? IS NULL OR library.created_at<? OR (library.created_at=? AND library.id<?))
      AND (?='all' OR (?='lend' AND library.is_consumable=0) OR (?='give' AND library.is_consumable=1)
        OR (?='unshared' AND NOT EXISTS(SELECT 1 FROM item_caches a
          JOIN caches c ON c.id=a.cache_id AND c.join_secret IS NOT NULL
          JOIN memberships m ON m.cache_id=c.id AND m.user_id=library.owner_id AND m.status='active'
          WHERE a.item_id=library.id)))
      ORDER BY library.created_at DESC,library.id DESC LIMIT 26`).bind(userId,time,time,time,id,filter,filter,filter,filter),
    db.prepare(`SELECT COUNT(*) AS total_count,COUNT(CASE WHEN i.is_consumable=0 THEN 1 END) AS lend_count,
      COUNT(CASE WHEN i.is_consumable=1 THEN 1 END) AS give_count,
      COUNT(CASE WHEN NOT EXISTS(SELECT 1 FROM item_caches a
        JOIN caches c ON c.id=a.cache_id AND c.join_secret IS NOT NULL
        JOIN memberships m ON m.cache_id=c.id AND m.user_id=i.owner_id AND m.status='active'
        WHERE a.item_id=i.id) THEN 1 END) AS unshared_count,
      (SELECT COUNT(DISTINCT a.cache_id) FROM item_caches a JOIN items owned ON owned.id=a.item_id AND owned.owner_id=?
        JOIN caches c ON c.id=a.cache_id AND c.join_secret IS NOT NULL
        JOIN memberships m ON m.cache_id=c.id AND m.user_id=owned.owner_id AND m.status='active') AS shared_cache_count
      FROM items i WHERE i.owner_id=?`).bind(userId,userId),
  ])
  const rows = page.results as LibraryRow[]
  const photos = await profilePhotoVersions(db,userId,[userId])
  const items = rows.slice(0,25).map(row=>({...libraryItemInfo(row),owner_photo_version:photos.get(row.owner_id) ?? null})), last = items.at(-1)
  return { items, next_cursor: rows.length > 25 ? `${last!.created_at}.${last!.id}` : null,
    totals:counts.results[0] as {total_count:number;lend_count:number;give_count:number;unshared_count:number;shared_cache_count:number} }
}

export async function cacheItems(db: D1Database, cacheId: string, userId: string) {
  const [cache, items] = await db.batch([
    db.prepare(cacheRead).bind(userId, cacheId),
    db.prepare(`SELECT visible.*,(SELECT COUNT(*) FROM requests r
      JOIN memberships requester ON requester.cache_id=r.cache_id AND requester.user_id=r.requester_id AND requester.status='active'
      WHERE r.item_id=visible.id AND r.cache_id=? AND r.status='pending') AS pending_count
      FROM (${itemRead} WHERE ${itemAccess}) visible ORDER BY visible.created_at DESC,visible.id`)
      .bind(cacheId,cacheId,userId,userId,cacheId),
  ])
  if (!cache.results.length) throw new HttpError(404, 'not_found')
  const rows = items.results as (ItemRow & {pending_count:number})[]
  const photos = await profilePhotoVersions(db,userId,rows.map(row=>row.owner_id))
  return rows.map(row=>({...itemInfo(row,cacheId),owner_photo_version:photos.get(row.owner_id) ?? null}))
}

export async function readItem(db: D1Database, itemId: string, userId: string, cacheId: string | null = null, ownerOnly = false) {
  const row = await db.prepare(`${itemRead} WHERE i.id=? AND (?=0 OR i.owner_id=?) AND (${itemAccess})`)
    .bind(itemId, ownerOnly ? 1 : 0, userId, cacheId, userId, userId, cacheId).first<ItemRow>()
  if (!row) throw new HttpError(404, 'not_found')
  return row
}

export async function itemDetail(db: D1Database, itemId: string, userId: string, cacheId: string | null = null) {
  let item
  if (cacheId !== null) item = itemInfo(await readItem(db,itemId,userId,cacheId),cacheId)
  else {
    const row = await db.prepare(`${libraryRead} WHERE library.id=?`).bind(userId,itemId).first<LibraryRow>()
    if (!row) throw new HttpError(404,'not_found')
    item = libraryItemInfo(row)
  }
  const photos = await profilePhotoVersions(db,userId,[item.owner_id])
  return {...item,owner_photo_version:photos.get(item.owner_id) ?? null}
}

export async function createItem(db: D1Database, userId: string, changes: ItemChanges, cacheId: string | null = null) {
  const id = crypto.randomUUID(), token = crypto.randomUUID(), now = Date.now()
  const access = `(? IS NULL OR EXISTS(SELECT 1 FROM memberships m JOIN caches c ON c.id=m.cache_id
    AND c.join_secret IS NOT NULL WHERE m.cache_id=? AND m.user_id=u.id AND m.status='active'))`
  const [created,_attachment,quota] = await db.batch([
    db.prepare(`INSERT INTO items(id,owner_id,title,description,is_consumable,quantity,available,created_at,operation_token)
      SELECT ?,?,?,?,?,?,?,?,? FROM user u JOIN plan_limits l ON l.plan=u.plan
      WHERE u.id=? AND ${ownedItemCount}<l.owned_items AND ${access}`)
      .bind(id,userId,changes.title!,changes.description ?? null,changes.is_consumable ? 1 : 0,changes.quantity ?? null,changes.available === false ? 0 : 1,now,token,userId,cacheId,cacheId),
    db.prepare(`INSERT INTO item_caches(item_id,cache_id,attached_at)
      SELECT id,?,? FROM items WHERE id=? AND owner_id=? AND operation_token=? AND ? IS NOT NULL`)
      .bind(cacheId,now,id,userId,token,cacheId),
    db.prepare(`SELECT ${ownedItemCount} AS used,l.owned_items AS maximum FROM user u
      LEFT JOIN plan_limits l ON l.plan=u.plan WHERE u.id=? AND ${access}`).bind(userId,cacheId,cacheId),
  ])
  if (created.meta.changes === 0) {
    const row = quota.results[0] as {used:number;maximum:number|null} | undefined
    if (!row) throw new HttpError(404,'not_found')
    checkQuota('owned_items',row.used,row.maximum)
    throw new Error('Item quota guard failed')
  }
  return itemDetail(db, id, userId, cacheId)
}

export async function updateItem(db: D1Database, itemId: string, userId: string, changes: ItemChanges, cacheId: string | null = null) {
  const token = crypto.randomUUID()
  const result = await db.prepare(`UPDATE items AS i SET title=COALESCE(?,title),
    description=CASE WHEN ? THEN ? ELSE description END,quantity=CASE WHEN ? THEN ? ELSE quantity END,
    available=COALESCE(?,available),operation_token=?
    WHERE i.id=? AND i.owner_id=? AND (${itemAccess}) AND (?=0 OR i.is_consumable=(? IS NOT NULL))
    AND (?=0 OR ? IS NULL OR ?>=(SELECT COALESCE(SUM(quantity),0) FROM requests WHERE item_id=i.id AND status='pending'))`)
    .bind(changes.title ?? null, changes.description !== undefined ? 1 : 0, changes.description ?? null,
      changes.quantity !== undefined ? 1 : 0, changes.quantity ?? null, changes.available === undefined ? null : changes.available ? 1 : 0,
      token, itemId, userId,
      cacheId, userId, userId, cacheId, changes.quantity !== undefined ? 1 : 0, changes.quantity ?? null,
      changes.quantity !== undefined ? 1 : 0, changes.quantity ?? null, changes.quantity ?? null).run()
  if (result.meta.changes === 0) {
    const item = await readItem(db, itemId, userId, cacheId, true)
    if (changes.quantity !== undefined && (item.is_consumable === 1) !== (changes.quantity !== null)) throw new HttpError(400, 'invalid_quantity')
    throw new HttpError(409, 'quantity_reserved')
  }
  return itemDetail(db, itemId, userId, cacheId)
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
