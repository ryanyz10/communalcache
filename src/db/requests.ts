// Party history, cache request queues and atomic all-cache stock decisions.
import { HttpError } from '../http'
import type { DecisionInput } from '../requests'
import type { CatCoat } from '../../shared/cat-coats'
import { readItem } from './items'
import { checkQuota, openRequestCount } from './limits'
import { profilePhotoVersions } from './profiles'
import { itemAccess, itemRead, requestContext } from './shared'

export type D1Request = {
  id: string; item_id: string; cache_id: string; cache_name: string; item_title: string
  owner_id: string; owner_name: string | null; requester_id: string; requester_name: string | null
  owner_photo_version?: string | null; requester_photo_version?: string | null
  owner_cat_coat?: CatCoat | null; requester_cat_coat?: CatCoat | null
  quantity: number | null; status: 'pending' | 'approved' | 'rejected'; decision_reason: string | null
  decided_at: number | null; created_at: number; approval_message?: string | null; queue_position?: number | null
}

async function requestPhotos(db: D1Database, readerId: string, rows: D1Request[]) {
  const photos = await profilePhotoVersions(db,readerId,rows.flatMap(row=>[row.owner_id,row.requester_id]))
  return rows.map(row=>({...row,owner_photo_version:photos.get(row.owner_id) ?? null,requester_photo_version:photos.get(row.requester_id) ?? null}))
}

const requestColumns = `r.id AS id,r.item_id,r.cache_id,c.name AS cache_name,i.title AS item_title,
  i.owner_id,owner.display_name AS owner_name,owner.cat_coat AS owner_cat_coat,
  r.requester_id,requester.display_name AS requester_name,requester.cat_coat AS requester_cat_coat,
  r.quantity,r.status,r.decision_reason,r.approval_message,r.decided_at,r.created_at AS created_at`
const requestFrom = `FROM requests r
  JOIN items i ON i.id=r.item_id JOIN caches c ON c.id=r.cache_id
  JOIN user owner ON owner.id=i.owner_id JOIN user requester ON requester.id=r.requester_id`
const requestRead = `SELECT ${requestColumns} ${requestFrom}`
// Only the owner, or this pending reusable request's requester, receives the count.
const queueRead = `SELECT ${requestColumns},CASE WHEN r.status='pending'
  AND (i.owner_id=? OR (r.requester_id=? AND i.is_consumable=0))
  THEN (SELECT 1+COUNT(*) FROM requests earlier WHERE earlier.item_id=r.item_id AND earlier.status='pending'
    AND (earlier.created_at,earlier.id)<(r.created_at,r.id)) ELSE NULL END AS queue_position ${requestFrom}`

export async function createRequest(db: D1Database, itemId: string, cacheId: string, userId: string, quantity: number | null) {
  // Bound JS integers can be REAL in SQLite; integer equality avoids relying on parameter typeof().
  const id = crypto.randomUUID(), token = crypto.randomUUID(), now = Date.now()
  const [created,_outbox,result,quota] = await db.batch([
    db.prepare(`INSERT INTO requests(id,item_id,cache_id,requester_id,quantity,status,created_at,creation_token)
      SELECT ?,i.id,?,?,?,'pending',?,? FROM items i JOIN item_caches a ON a.item_id=i.id AND a.cache_id=?
      JOIN caches c ON c.id=a.cache_id AND c.join_secret IS NOT NULL
      JOIN memberships caller ON caller.cache_id=c.id AND caller.user_id=? AND caller.status='active'
      JOIN memberships owner ON owner.cache_id=c.id AND owner.user_id=i.owner_id AND owner.status='active'
      JOIN user u ON u.id=caller.user_id JOIN plan_limits l ON l.plan=u.plan
      WHERE i.id=? AND i.owner_id<>? AND i.available=1 AND ${openRequestCount}<l.open_requests
      AND ((i.is_consumable=0 AND ? IS NULL)
        OR (i.is_consumable=1 AND ? BETWEEN 1 AND 9999 AND ?=CAST(? AS INTEGER)
          AND i.quantity-(SELECT COALESCE(SUM(quantity),0) FROM requests WHERE item_id=i.id AND status='pending')>=?))`)
      .bind(id,cacheId,userId,quantity,now,token,cacheId,userId,itemId,userId,quantity,quantity,quantity,quantity,quantity),
    db.prepare(`INSERT INTO outbox(id,kind,dedupe_key,payload,created_at)
      SELECT ?,'request_created',?,json_object('event','request_created','cache_id',c.id,'cache_name',c.name,
        'item_id',i.id,'item_title',i.title,'request_id',r.id,'recipient_id',i.owner_id,'user_id',r.requester_id,'quantity',r.quantity),?
      FROM requests r JOIN items i ON i.id=r.item_id JOIN caches c ON c.id=r.cache_id WHERE r.id=? AND r.creation_token=?`)
      .bind(token,token,now,id,token),
    db.prepare(`${requestRead} WHERE r.id=? AND r.creation_token=?`).bind(id,token),
    db.prepare(`SELECT ${openRequestCount} AS used,l.open_requests AS maximum FROM user u
      LEFT JOIN plan_limits l ON l.plan=u.plan WHERE u.id=?`).bind(userId),
  ])
  if (created.meta.changes === 0) {
    const item = await readItem(db,itemId,userId,cacheId)
    if (item.owner_id === userId) throw new HttpError(404,'not_found')
    if ((item.is_consumable === 1) !== (quantity !== null) || (quantity !== null && (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999))) throw new HttpError(400,'invalid_request_quantity')
    if (!item.available || (item.is_consumable === 1 && quantity!>item.available_quantity!)) throw new HttpError(409,item.available ? 'insufficient_stock' : 'item_unavailable')
    const row = quota.results[0] as {used:number;maximum:number|null}
    checkQuota('open_requests',row.used,row.maximum)
    throw new HttpError(409,'insufficient_stock')
  }
  return {request:(await requestPhotos(db,userId,result.results as D1Request[]))[0],notificationId:token}
}

export async function itemRequests(db: D1Database, itemId: string, cacheId: string, userId: string) {
  const [item, requests] = await db.batch([
    db.prepare(`${itemRead} WHERE i.id=? AND (${itemAccess})`).bind(itemId,cacheId,userId,userId,cacheId),
    db.prepare(`${queueRead} WHERE r.item_id=? AND r.cache_id=? AND (${itemAccess})
      AND (r.status='pending' OR r.requester_id=? OR i.owner_id=?)
      ORDER BY (r.status='pending') DESC,CASE WHEN r.status='pending' THEN r.created_at END ASC,
        CASE WHEN r.status='pending' THEN r.id END ASC,r.created_at DESC,r.id DESC`)
      .bind(userId,userId,itemId,cacheId,cacheId,userId,userId,cacheId,userId,userId),
  ])
  if (!item.results.length) throw new HttpError(404,'not_found')
  return requestPhotos(db,userId,requests.results as D1Request[])
}

export async function decideRequest(db: D1Database, requestId: string, userId: string, action: 'approve' | 'reject', input: DecisionInput, cacheId: string | null = null) {
  const token = crypto.randomUUID(), now = Date.now(), status = action === 'approve' ? 'approved' : 'rejected', event = `request_${status}`
  const markLentOut = action === 'approve' && input.mark_lent_out
  const [decided, _stock, _availability, _outbox, result] = await db.batch([
    db.prepare(`UPDATE requests AS r SET status=?,decision_reason=?,approval_message=?,decided_at=?,decision_token=?
      WHERE r.id=? AND r.status='pending' AND (? IS NULL OR r.cache_id=?)
      AND EXISTS(SELECT 1 FROM items i WHERE i.id=r.item_id AND i.owner_id=? AND ${requestContext}
        AND (?=0 OR i.is_consumable=0) AND (?=0 OR i.is_consumable=0 OR i.quantity>=r.quantity))`)
      .bind(status,input.reason,action === 'approve' ? input.approval_message ?? null : null,now,token,requestId,cacheId,cacheId,userId,markLentOut ? 1 : 0,action === 'approve' ? 1 : 0),
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
  return {request:(await requestPhotos(db,userId,result.results as D1Request[]))[0],notificationId:token}
}

export async function requestDetail(db: D1Database, requestId: string, userId: string) {
  const row = await db.prepare(`${queueRead} WHERE r.id=? AND (i.owner_id=? OR r.requester_id=?)`)
    .bind(userId,userId,requestId,userId,userId).first<D1Request>()
  if (!row) throw new HttpError(404,'not_found')
  // Party history is not cache/item/photo/contact permission.
  return (await requestPhotos(db,userId,[row]))[0]
}

export async function requestsPage(db: D1Database, userId: string, after: string | null) {
  let time: number | null = null, id: string | null = null
  if (after !== null) {
    const match = after.match(/^([0-9]{1,16})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw new HttpError(400,'invalid_cursor')
    time = Number(match[1]); id = match[2].toLowerCase()
  }
  const cursor = '(? IS NULL OR r.created_at<? OR (r.created_at=? AND r.id<?))'
  const rows = (await db.prepare(`${queueRead} WHERE i.owner_id=? AND ${cursor}
    UNION ${queueRead} WHERE r.requester_id=? AND ${cursor} ORDER BY created_at DESC,id DESC LIMIT 26`)
    .bind(userId,userId,userId,time,time,time,id,userId,userId,userId,time,time,time,id).all<D1Request>()).results
  const requests = await requestPhotos(db,userId,rows.slice(0,25)), last = requests.at(-1)
  return { requests, unavailable_cache_ids: [], next_cursor: rows.length > 25 ? `${last!.created_at}.${last!.id}` : null }
}

export async function incomingRequestsPage(db: D1Database, userId: string, after: string | null) {
  let cursor: [number, string, number, string] | null = null
  if (after !== null) {
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    const match = after.match(new RegExp(`^([0-9]{1,16})\\.(${uuid})\\.([0-9]{1,16})\\.(${uuid})$`, 'i'))
    if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[3]))) throw new HttpError(400,'invalid_cursor')
    cursor = [Number(match[1]), match[2].toLowerCase(), Number(match[3]), match[4].toLowerCase()]
  }
  const rows = (await db.prepare(`WITH pending AS (
    SELECT r.id,MIN(r.created_at) OVER (PARTITION BY r.item_id) AS oldest_at,
      ROW_NUMBER() OVER (PARTITION BY r.item_id ORDER BY r.created_at,r.id) AS queue_position
    FROM requests r JOIN items i ON i.id=r.item_id WHERE i.owner_id=? AND r.status='pending'
  ) SELECT ${requestColumns},q.queue_position,q.oldest_at ${requestFrom} JOIN pending q ON q.id=r.id
    WHERE i.owner_id=? AND (? IS NULL OR (q.oldest_at,r.item_id,r.created_at,r.id)>(?,?,?,?))
    ORDER BY q.oldest_at,r.item_id,r.created_at,r.id LIMIT 26`)
    .bind(userId,userId,cursor?.[0] ?? null,...(cursor ?? [null,null,null,null])).all<D1Request & { oldest_at: number }>()).results
  const page = rows.slice(0,25), last = page.at(-1)
  const requests = await requestPhotos(db,userId,page.map(({ oldest_at: _oldest, ...row }) => row))
  return { requests, unavailable_cache_ids: [], next_cursor: rows.length > 25
    ? `${last!.oldest_at}.${last!.item_id}.${last!.created_at}.${last!.id}` : null }
}
