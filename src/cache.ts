import { DurableObject } from 'cloudflare:workers'
import { applyCacheIntent } from './db'

export type CacheInfo = { id: string; name: string; owner_id: string; invite_token: string; requires_approval: boolean }
type CacheRow = { id: string; name: string; join_secret: string; requires_approval: number; created_at: number; owner_id: string }
export type ItemInfo = { id: string; cache_id: string; owner_id: string; title: string; description: string | null; is_consumable: boolean; quantity: number | null; created_at: number; photo_version: string | null }
type ItemRow = Omit<ItemInfo, 'is_consumable' | 'photo_version'> & { is_consumable: number; photo_path: string | null }
export type RequestInfo = {
  id: string; cache_id: string; cache_name: string; item_id: string; item_title: string; owner_id: string; requester_id: string
  quantity: number | null; status: 'pending' | 'approved' | 'rejected'; decision_reason: string | null; decided_at: number | null; created_at: number
}

function itemInfo(row: ItemRow): ItemInfo {
  const { photo_path, ...item } = row
  return { ...item, is_consumable: row.is_consumable === 1, photo_version: photo_path?.split('/').at(-1) ?? null }
}

function itemChanges(body: Record<string, unknown>, consumable: boolean, creating: boolean) {
  const changes: { title?: string; description?: string | null; quantity?: number | null } = {}
  if (Object.hasOwn(body, 'owner_id')) throw new Error('not_found')
  if (!creating && Object.hasOwn(body, 'is_consumable')) throw new Error('immutable_is_consumable')
  if (creating || Object.hasOwn(body, 'title')) {
    if (typeof body.title !== 'string' || !body.title.trim() || [...body.title.trim()].length > 120) throw new Error('invalid_title')
    changes.title = body.title.trim()
  }
  if (Object.hasOwn(body, 'description')) {
    if (body.description !== null && (typeof body.description !== 'string' || [...body.description.trim()].length > 2000)) throw new Error('invalid_description')
    changes.description = typeof body.description === 'string' ? body.description.trim() || null : null
  }
  if (creating || Object.hasOwn(body, 'quantity')) {
    if (consumable) {
      if (typeof body.quantity !== 'number' || !Number.isInteger(body.quantity) || body.quantity < 0 || body.quantity > 9999) throw new Error('invalid_quantity')
      changes.quantity = body.quantity
    } else {
      if (body.quantity !== undefined && body.quantity !== null) throw new Error('invalid_quantity')
      changes.quantity = null
    }
  }
  if (!creating && !Object.keys(changes).length) throw new Error('invalid_json')
  return changes
}

function newSecret() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function decodeSecret(secret: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(secret)) return null
  return Uint8Array.from(atob(secret.replaceAll('-', '+').replaceAll('_', '/') + '='), char => char.charCodeAt(0))
}

function sameSecret(candidate: string, stored: string) {
  const left = decodeSecret(candidate)
  const right = decodeSecret(stored)
  if (!left || !right) return false
  return crypto.subtle.timingSafeEqual(left, right)
}

function cacheInfo(row: CacheRow): CacheInfo {
  return { id: row.id, name: row.name, owner_id: row.owner_id, invite_token: `${row.id}.${row.join_secret}`, requires_approval: row.requires_approval === 1 }
}

export function migrateCache(storage: DurableObjectStorage) {
  storage.transactionSync(() => {
    const sql = storage.sql
    sql.exec('CREATE TABLE IF NOT EXISTS schema_version (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), version INTEGER NOT NULL)')
    const version = sql.exec<{ version: number }>('SELECT version FROM schema_version WHERE singleton = 1').toArray()[0]?.version ?? 0
    if (version > 2) throw new Error('Unsupported cache schema version')
    if (version < 1) {
      sql.exec(`
        CREATE TABLE cache_config (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, join_secret TEXT NOT NULL,
          requires_approval INTEGER NOT NULL DEFAULT 0 CHECK(requires_approval IN (0, 1)),
          created_at INTEGER NOT NULL
        );
        CREATE TABLE members (
          user_id TEXT PRIMARY KEY NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('owner', 'member')),
          status TEXT NOT NULL CHECK(status IN ('active', 'pending', 'removed')),
          created_at INTEGER NOT NULL,
          CHECK(role <> 'owner' OR status = 'active')
        );
        CREATE UNIQUE INDEX one_owner ON members(role) WHERE role = 'owner';
        CREATE TABLE items (
          id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES members(user_id),
          title TEXT NOT NULL, description TEXT, photo_path TEXT,
          is_consumable INTEGER NOT NULL CHECK(is_consumable IN (0, 1)), quantity INTEGER,
          created_at INTEGER NOT NULL,
          CHECK(is_consumable = (quantity IS NOT NULL)),
          CHECK(quantity IS NULL OR (typeof(quantity) = 'integer' AND quantity BETWEEN 0 AND 9999))
        );
        CREATE INDEX items_owner ON items(owner_id);
        CREATE TABLE requests (
          id TEXT PRIMARY KEY NOT NULL, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          requester_id TEXT NOT NULL REFERENCES members(user_id), quantity INTEGER,
          status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
          decision_reason TEXT, decided_at INTEGER, created_at INTEGER NOT NULL,
          CHECK(quantity IS NULL OR (typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 9999)),
          CHECK((status = 'pending') = (decided_at IS NULL)),
          CHECK(status <> 'rejected' OR decision_reason IS NOT NULL)
        );
        CREATE INDEX pending_requests ON requests(item_id) WHERE status = 'pending';
        CREATE INDEX requests_requester ON requests(requester_id);
      `)
    }
    if (version < 2) {
      sql.exec(`CREATE TABLE pending_sync (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`)
    }
    sql.exec('INSERT INTO schema_version (singleton, version) VALUES (1, 2) ON CONFLICT(singleton) DO UPDATE SET version = excluded.version')
  })
}

export class Cache extends DurableObject<Env> {
  private draining: Promise<void> | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => { migrateCache(ctx.storage) })
  }

  private async rearm() {
    try {
      if (!this.ctx.storage.sql.exec('SELECT 1 FROM pending_sync LIMIT 1').toArray().length) return
      const retry = await this.ctx.storage.get<{ failures: number; retryAt: number }>('sync_retry')
      const alarm = await this.ctx.storage.getAlarm()
      const next = Math.max(Date.now() + 5_000, retry?.retryAt ?? 0)
      if (alarm === null || (retry && alarm < retry.retryAt) || (!retry && alarm > next)) await this.ctx.storage.setAlarm(next)
    } catch {
      // ponytail: a pre-registry cache needs its returned ID/entry-point retry to repair this window.
      console.error('Cache sync alarm scheduling failed')
    }
  }

  private recordIntent(kind: string, payload: unknown) {
    this.ctx.storage.sql.exec('INSERT INTO pending_sync(id, kind, payload, created_at) VALUES (?, ?, ?, ?)', crypto.randomUUID(), kind, JSON.stringify(payload), Date.now())
  }

  private readCache(userId: string, ownerOnly = false): CacheRow {
    const row = this.ctx.storage.sql.exec<CacheRow>(`
      SELECT c.id, c.name, c.join_secret, c.requires_approval, c.created_at, o.user_id AS owner_id
      FROM cache_config c JOIN members o ON o.role = 'owner' AND o.status = 'active'
      JOIN members caller ON caller.user_id = ? AND caller.status = 'active'
      WHERE c.singleton = 1 AND (? = 0 OR caller.role = 'owner')
    `, userId, ownerOnly ? 1 : 0).toArray()[0]
    if (!row) throw new Error('not_found')
    return row
  }

  async create(cacheId: string, ownerId: string, name: string, requiresApproval: boolean) {
    await this.rearm()
    const result = this.ctx.storage.transactionSync(() => {
      if (this.ctx.storage.sql.exec('SELECT 1 FROM cache_config').toArray().length) throw new Error('cache_exists')
      const now = Date.now()
      this.ctx.storage.sql.exec('INSERT INTO cache_config(singleton, id, name, join_secret, requires_approval, created_at) VALUES (1, ?, ?, ?, ?, ?)', cacheId, name, newSecret(), requiresApproval ? 1 : 0, now)
      this.ctx.storage.sql.exec("INSERT INTO members(user_id, role, status, created_at) VALUES (?, 'owner', 'active', ?)", ownerId, now)
      this.recordIntent('registry_upsert', { cache_id: cacheId, name, created_at: now })
      this.recordIntent('discovery_upsert', { cache_id: cacheId, user_id: ownerId })
      return cacheInfo(this.readCache(ownerId))
    })
    await this.rearm()
    return result
  }

  async detail(userId: string) {
    await this.rearm()
    const row = this.readCache(userId)
    const members = this.ctx.storage.sql.exec<{ user_id: string }>("SELECT user_id FROM members WHERE status = 'active' ORDER BY created_at, user_id").toArray()
    return { ...cacheInfo(row), members }
  }

  async update(userId: string, changes: { name?: string; requires_approval?: boolean }) {
    await this.rearm()
    const result = this.ctx.storage.transactionSync(() => {
      const row = this.readCache(userId, true)
      if (changes.name !== undefined) {
        this.ctx.storage.sql.exec('UPDATE cache_config SET name = ? WHERE singleton = 1', changes.name)
        this.recordIntent('registry_upsert', { cache_id: row.id, name: changes.name, created_at: row.created_at })
      }
      if (changes.requires_approval !== undefined) this.ctx.storage.sql.exec('UPDATE cache_config SET requires_approval = ? WHERE singleton = 1', changes.requires_approval ? 1 : 0)
      return cacheInfo(this.readCache(userId))
    })
    await this.rearm()
    return result
  }

  async rotateInvite(userId: string) {
    await this.rearm()
    return this.ctx.storage.transactionSync(() => {
      this.readCache(userId, true)
      this.ctx.storage.sql.exec('UPDATE cache_config SET join_secret = ? WHERE singleton = 1', newSecret())
      return cacheInfo(this.readCache(userId))
    })
  }

  async join(userId: string, secret: string) {
    await this.rearm()
    const result = this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql.exec<CacheRow>(`
        SELECT c.*, o.user_id AS owner_id FROM cache_config c
        JOIN members o ON o.role = 'owner' AND o.status = 'active' WHERE c.singleton = 1
      `).toArray()[0]
      if (!row || !sameSecret(secret, row.join_secret)) throw new Error('not_found')
      const existing = this.ctx.storage.sql.exec<{ status: 'active' | 'pending' | 'removed' }>('SELECT status FROM members WHERE user_id = ?', userId).toArray()[0]
      if (existing?.status === 'removed') throw new Error('member_removed')
      if (existing) return { cache_id: row.id, name: row.name, status: existing.status }
      const status = row.requires_approval === 1 ? 'pending' : 'active'
      this.ctx.storage.sql.exec("INSERT INTO members(user_id, role, status, created_at) VALUES (?, 'member', ?, ?)", userId, status, Date.now())
      if (status === 'active') this.recordIntent('discovery_upsert', { cache_id: row.id, user_id: userId })
      else this.recordIntent('notification', { event: 'join_requested', cache_id: row.id, cache_name: row.name, recipient_id: row.owner_id, user_id: userId })
      return { cache_id: row.id, name: row.name, status }
    })
    await this.rearm()
    return result
  }

  async joinRequests(userId: string) {
    await this.rearm()
    this.readCache(userId, true)
    return this.ctx.storage.sql.exec<{ user_id: string; created_at: number }>("SELECT user_id, created_at FROM members WHERE status = 'pending' ORDER BY created_at, user_id").toArray()
  }

  async decideJoin(userId: string, applicantId: string, decision: 'approve' | 'reject') {
    await this.rearm()
    const result = this.ctx.storage.transactionSync(() => {
      const row = this.readCache(userId, true)
      const pending = this.ctx.storage.sql.exec<{ user_id: string }>("SELECT user_id FROM members WHERE user_id = ? AND status = 'pending'", applicantId).toArray()[0]
      if (!pending) throw new Error('join_not_pending')
      // Snapshot the recipient before rejection deletes their membership.
      this.recordIntent('notification', { event: decision === 'approve' ? 'join_approved' : 'join_rejected', cache_id: row.id, cache_name: row.name, recipient_id: pending.user_id, user_id: pending.user_id })
      if (decision === 'approve') {
        this.ctx.storage.sql.exec("UPDATE members SET status = 'active' WHERE user_id = ? AND status = 'pending'", pending.user_id)
        this.recordIntent('discovery_upsert', { cache_id: row.id, user_id: pending.user_id })
      } else {
        this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id = ? AND status = 'pending'", pending.user_id)
      }
      return { status: decision === 'approve' ? 'active' : 'rejected' }
    })
    await this.rearm()
    return result
  }

  private readItem(userId: string, itemId: string, ownerOnly = false): ItemRow {
    const row = this.ctx.storage.sql.exec<ItemRow>(`
      SELECT i.id, c.id AS cache_id, i.owner_id, i.title, i.description, i.is_consumable, i.quantity, i.created_at, i.photo_path
      FROM items i JOIN members caller ON caller.user_id = ? AND caller.status = 'active'
      JOIN cache_config c ON c.singleton = 1
      WHERE i.id = ? AND (? = 0 OR i.owner_id = caller.user_id)
    `, userId, itemId, ownerOnly ? 1 : 0).toArray()[0]
    if (!row) throw new Error('not_found')
    return row
  }

  async listItems(userId: string) {
    await this.rearm()
    return this.ctx.storage.transactionSync(() => {
      const cache = this.readCache(userId)
      return this.ctx.storage.sql.exec<ItemRow>(`
        SELECT id, ? AS cache_id, owner_id, title, description, is_consumable, quantity, created_at, photo_path
        FROM items ORDER BY created_at DESC, id
      `, cache.id).toArray().map(itemInfo)
    })
  }

  async itemDetail(userId: string, itemId: string) {
    await this.rearm()
    return this.ctx.storage.transactionSync(() => itemInfo(this.readItem(userId, itemId)))
  }

  async createItem(userId: string, body: Record<string, unknown>) {
    await this.rearm()
    return this.ctx.storage.transactionSync(() => {
      this.readCache(userId)
      if (typeof body.is_consumable !== 'boolean') throw new Error('invalid_is_consumable')
      const changes = itemChanges(body, body.is_consumable, true)
      const id = crypto.randomUUID()
      this.ctx.storage.sql.exec(`
        INSERT INTO items(id, owner_id, title, description, is_consumable, quantity, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, id, userId, changes.title!, changes.description ?? null, body.is_consumable ? 1 : 0, changes.quantity!, Date.now())
      return itemInfo(this.readItem(userId, id))
    })
  }

  async updateItem(userId: string, itemId: string, body: Record<string, unknown>) {
    await this.rearm()
    return this.ctx.storage.transactionSync(() => {
      const item = this.readItem(userId, itemId, true)
      const changes = itemChanges(body, item.is_consumable === 1, false)
      if (changes.quantity !== undefined && changes.quantity !== null) {
        const pending = this.ctx.storage.sql.exec<{ quantity: number }>("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM requests WHERE item_id = ? AND status = 'pending'", itemId).one().quantity
        if (changes.quantity < pending) throw new Error('quantity_reserved')
      }
      this.ctx.storage.sql.exec('UPDATE items SET title = ?, description = ?, quantity = ? WHERE id = ?',
        changes.title ?? item.title, changes.description === undefined ? item.description : changes.description,
        changes.quantity === undefined ? item.quantity : changes.quantity, itemId)
      return itemInfo(this.readItem(userId, itemId))
    })
  }

  private readRequests(userId: string, itemId: string | null, requestId: string | null, publicPending: boolean) {
    return this.ctx.storage.sql.exec<RequestInfo>(`
      SELECT r.id, c.id AS cache_id, c.name AS cache_name, r.item_id, i.title AS item_title, i.owner_id,
        r.requester_id, r.quantity, r.status, r.decision_reason, r.decided_at, r.created_at
      FROM requests r JOIN items i ON i.id = r.item_id
      JOIN cache_config c ON c.singleton = 1
      JOIN members caller ON caller.user_id = ? AND caller.status = 'active'
      WHERE (? IS NULL OR r.item_id = ?) AND (? IS NULL OR r.id = ?)
        AND (r.requester_id = ? OR i.owner_id = ? OR (? = 1 AND r.status = 'pending'))
      ORDER BY r.created_at DESC, r.id
    `, userId, itemId, itemId, requestId, requestId, userId, userId, publicPending ? 1 : 0).toArray()
  }

  async itemRequests(userId: string, itemId: string) {
    await this.rearm()
    return this.ctx.storage.transactionSync(() => {
      this.readItem(userId, itemId)
      return this.readRequests(userId, itemId, null, true)
    })
  }

  async requestsForMember(userId: string) {
    await this.rearm()
    return this.ctx.storage.transactionSync(() => {
      this.readCache(userId)
      return this.readRequests(userId, null, null, false)
    })
  }

  async createRequest(userId: string, itemId: string, body: Record<string, unknown>) {
    await this.rearm()
    const result = this.ctx.storage.transactionSync(() => {
      const item = this.readItem(userId, itemId)
      if (item.owner_id === userId || Object.hasOwn(body, 'requester_id') || Object.hasOwn(body, 'owner_id')) throw new Error('not_found')
      let quantity: number | null = null
      if (item.is_consumable === 1) {
        if (typeof body.quantity !== 'number' || !Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 9999) throw new Error('invalid_request_quantity')
        quantity = body.quantity
        const pending = this.ctx.storage.sql.exec<{ quantity: number }>("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM requests WHERE item_id = ? AND status = 'pending'", itemId).one().quantity
        if (quantity > item.quantity! - pending) throw new Error('insufficient_stock')
      } else if (body.quantity !== undefined && body.quantity !== null) throw new Error('invalid_request_quantity')
      const id = crypto.randomUUID(), now = Date.now()
      this.ctx.storage.sql.exec("INSERT INTO requests(id, item_id, requester_id, quantity, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)", id, itemId, userId, quantity, now)
      const request = this.readRequests(userId, itemId, id, false)[0]
      this.recordIntent('notification', { event: 'request_created', cache_id: item.cache_id, cache_name: request.cache_name, item_id: itemId, item_title: item.title, request_id: id, recipient_id: item.owner_id, user_id: userId, quantity, path: `/caches/${item.cache_id}/items/${itemId}` })
      return request
    })
    await this.rearm()
    return result
  }

  async decideRequest(userId: string, requestId: string, decision: 'approve' | 'reject', body: Record<string, unknown>) {
    await this.rearm()
    const result = this.ctx.storage.transactionSync(() => {
      const request = this.readRequests(userId, null, requestId, false)[0]
      if (!request || request.owner_id !== userId) throw new Error('not_found')
      if (request.status !== 'pending') throw new Error('request_not_pending')
      if (decision !== 'approve' && decision !== 'reject') throw new Error('invalid_decision')
      let reason: string | null = null
      if (decision === 'reject') {
        if (typeof body.reason !== 'string' || !body.reason.trim() || [...body.reason.trim()].length > 500) throw new Error('invalid_reason')
        reason = body.reason.trim()
      }
      const changed = this.ctx.storage.sql.exec("UPDATE requests SET status = ?, decision_reason = ?, decided_at = ? WHERE id = ? AND status = 'pending' RETURNING id", decision === 'approve' ? 'approved' : 'rejected', reason, Date.now(), requestId).toArray()
      if (!changed.length) throw new Error('request_not_pending')
      if (decision === 'approve' && request.quantity !== null) {
        const deducted = this.ctx.storage.sql.exec('UPDATE items SET quantity = quantity - ? WHERE id = ? AND quantity >= ? RETURNING id', request.quantity, request.item_id, request.quantity).toArray()
        if (!deducted.length) throw new Error('insufficient_stock')
      }
      this.recordIntent('notification', { event: decision === 'approve' ? 'request_approved' : 'request_rejected', cache_id: request.cache_id, cache_name: request.cache_name, item_id: request.item_id, item_title: request.item_title, request_id: request.id, recipient_id: request.requester_id, user_id: userId, quantity: request.quantity, reason, path: `/caches/${request.cache_id}/items/${request.item_id}` })
      return this.readRequests(userId, request.item_id, requestId, false)[0]
    })
    await this.rearm()
    return result
  }

  async photoKey(userId: string, itemId: string) {
    await this.rearm()
    return this.ctx.storage.transactionSync(() => {
      const item = this.readItem(userId, itemId)
      if (!item.photo_path) throw new Error('not_found')
      return item.photo_path
    })
  }

  async photoUploadKey(userId: string, itemId: string) {
    await this.rearm()
    return this.ctx.storage.transactionSync(() => {
      const item = this.readItem(userId, itemId, true)
      return `${item.cache_id}/${item.id}/${crypto.randomUUID()}`
    })
  }

  async finishPhotoUpload(userId: string, itemId: string, key: string, uploaded: boolean) {
    await this.rearm()
    const attached = this.ctx.storage.transactionSync(() => {
      const cacheId = this.ctx.storage.sql.exec<{ id: string }>('SELECT id FROM cache_config WHERE singleton = 1').one().id
      if (!key.startsWith(`${cacheId}/${itemId}/`) || !/^[0-9a-f-]{36}$/.test(key.slice(`${cacheId}/${itemId}/`.length))) throw new Error('not_found')
      let item: ItemRow | undefined
      try { item = this.readItem(userId, itemId, true) }
      catch (error) { if (!(error instanceof Error) || error.message !== 'not_found') throw error }
      const current = this.ctx.storage.sql.exec<{ photo_path: string | null }>('SELECT photo_path FROM items WHERE id = ?', itemId).toArray()[0]?.photo_path
      if (!uploaded || !item) {
        // An uncertain RPC response must not clean up an attachment that actually committed.
        if (current !== key) this.recordIntent('r2_delete', { key })
        return false
      }
      if (current === key) return true
      this.ctx.storage.sql.exec('UPDATE items SET photo_path = ? WHERE id = ?', key, itemId)
      if (current) this.recordIntent('r2_delete', { key: current })
      return true
    })
    await this.rearm()
    return attached
  }

  async schemaVersion() {
    await this.rearm()
    return this.ctx.storage.sql.exec<{ version: number }>('SELECT version FROM schema_version WHERE singleton = 1').one().version
  }

  private async drainWork() {
    // ponytail: 25 intent rows/drain (up to 50 binding calls); subsequent alarms keep draining in order.
    for (let count = 0; count < 25; count++) {
      const row = this.ctx.storage.sql.exec<{ sequence: number; id: string; kind: string; payload: string; created_at: number }>('SELECT sequence, id, kind, payload, created_at FROM pending_sync ORDER BY sequence LIMIT 1').toArray()[0]
      if (!row) return
      if (row.kind === 'r2_delete') {
        const { key } = JSON.parse(row.payload) as { key: string }
        await this.env.BUCKET.delete(key)
      } else {
        await applyCacheIntent(this.env.DB, row.kind, row.payload, row.id, row.created_at)
        if (row.kind === 'notification') await this.env.NOTIFICATIONS.send(row.id)
      }
      this.ctx.storage.sql.exec('DELETE FROM pending_sync WHERE sequence = ? AND id = ?', row.sequence, row.id)
    }
  }

  async flushSync(respectBackoff = false) {
    await this.rearm()
    if (respectBackoff) {
      const retry = await this.ctx.storage.get<{ failures: number; retryAt: number }>('sync_retry')
      if (retry && retry.retryAt > Date.now()) return
    }
    // Set the shared promise before awaiting: alarms and explicit flushes cannot reorder effects.
    this.draining ??= this.drainWork().then(async () => {
      await this.ctx.storage.delete('sync_retry')
    }, async error => {
      const previous = await this.ctx.storage.get<{ failures: number }>('sync_retry')
      const failures = Math.min((previous?.failures ?? 0) + 1, 11)
      await this.ctx.storage.put('sync_retry', { failures, retryAt: Date.now() + Math.min(5_000 * 2 ** (failures - 1), 3_600_000) })
      throw error
    }).finally(async () => {
      await this.rearm()
      this.draining = null
    })
    await this.draining
  }

  async alarm() {
    try { await this.flushSync() }
    catch { console.error('Cache sync failed; durable work retained') }
    finally { await this.rearm() }
  }
}
