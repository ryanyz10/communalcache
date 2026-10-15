import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { abortAllDurableObjects, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import worker from '../src/index'
import { aggregateRequests } from '../src/requests'
import { appRequest, login } from './helpers'

async function user(name = 'Neighbor') {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?, ?, ?, 1, ?, ?, ?)')
    .bind(id, '', `${id}@example.test`, new Date().toISOString(), new Date().toISOString(), name).run()
  return id
}
function cache(id = crypto.randomUUID()) { return { id, stub: env.CACHES.get(env.CACHES.idFromName(id)) } }
async function created() {
  const owner = await user('Owner'), member = await user('Member'), neighbor = await user('Neighbor')
  const { id, stub } = cache()
  const info = await stub.create(id, owner, 'Pantry', false), secret = info.invite_token.split('.')[1]
  await stub.join(member, secret)
  await stub.join(neighbor, secret)
  const owned = await stub.createItem(member, { title: 'Member sugar', is_consumable: true, quantity: 10 })
  const surviving = await stub.createItem(owner, { title: 'Owner sugar', is_consumable: true, quantity: 10 })
  await stub.flushSync()
  return { id, stub, owner, member, neighbor, owned, surviving, secret }
}
async function photo(stub: ReturnType<typeof cache>['stub'], owner: string, itemId: string) {
  const key = await stub.photoUploadKey(owner, itemId)
  await env.BUCKET.put(key, 'private photo', { httpMetadata: { contentType: 'image/jpeg' } })
  expect(await stub.finishPhotoUpload(owner, itemId, key, true)).toBe(true)
  return key
}
async function intents(stub: ReturnType<typeof cache>['stub']) {
  return runInDurableObject(stub, (_instance, state) => state.storage.sql.exec<{ id: string; kind: string; payload: string }>('SELECT id,kind,payload FROM pending_sync ORDER BY sequence').toArray())
}
async function failure(call: PromiseLike<unknown>, message: string) {
  let error: unknown
  try { await call } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain(message)
}

it('deletes items owner-only, snapshots only pending requesters, cascades history and defers exact/prefix R2 cleanup', async () => {
  const { id, stub, owner, member, neighbor, owned, surviving } = await created()
  const pending = await stub.createRequest(owner, owned.id, { quantity: 2 })
  const otherPending = await stub.createRequest(neighbor, owned.id, { quantity: 3 })
  const approved = await stub.createRequest(neighbor, owned.id, { quantity: 1 })
  await stub.decideRequest(member, approved.id, 'approve', {})
  const current = await photo(stub, member, owned.id), keep = await photo(stub, owner, surviving.id)
  await stub.flushSync()
  const orphan = `${id}/${owned.id}/${crypto.randomUUID()}`
  const boundary = `${id}/${owned.id}x/${crypto.randomUUID()}`
  await env.BUCKET.put(orphan, 'old unattached version')
  await env.BUCKET.put(boundary, 'outside the trailing-slash prefix')
  for (const caller of [owner, neighbor, 'outsider']) await failure(stub.deleteItem(caller, owned.id), 'not_found')
  await stub.deleteItem(member, owned.id)
  await failure(stub.itemDetail(member, owned.id), 'not_found')
  await failure(stub.itemRequests(owner, owned.id), 'not_found')
  expect(await env.BUCKET.head(current)).not.toBeNull()
  expect(await env.BUCKET.head(orphan)).not.toBeNull()
  const rows = await intents(stub), notifications = rows.filter(row => row.kind === 'notification').map(row => JSON.parse(row.payload))
  expect(notifications).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: 'item_deleted', recipient_id: owner, request_id: pending.id, item_title: owned.title, quantity: 2 }),
    expect.objectContaining({ event: 'item_deleted', recipient_id: neighbor, request_id: otherPending.id, quantity: 3 }),
  ]))
  expect(notifications).toHaveLength(2)
  expect(rows.find(row => row.kind === 'r2_delete')?.payload).toBe(JSON.stringify({ key: current }))
  expect(rows.find(row => row.kind === 'r2_delete_prefix')?.payload).toBe(JSON.stringify({ prefix: `${id}/${owned.id}/` }))
  await runInDurableObject(stub, (_instance, state) => { expect(state.storage.sql.exec('SELECT id FROM requests WHERE item_id=?', owned.id).toArray()).toEqual([]) })
  await stub.flushSync()
  expect(await env.BUCKET.head(current)).toBeNull()
  expect(await env.BUCKET.head(orphan)).toBeNull()
  expect(await env.BUCKET.head(keep)).not.toBeNull()
  expect(await env.BUCKET.head(boundary)).not.toBeNull()
  await failure(stub.deleteItem(member, owned.id), 'not_found')
  expect(await intents(stub)).toEqual([])
})

it('removes a member atomically across both request directions, preserving rejected/decided history on surviving items', async () => {
  const { id, stub, owner, member, neighbor, owned, surviving, secret } = await created()
  const incoming = await stub.createRequest(neighbor, owned.id, { quantity: 2 })
  const terminalIncoming = await stub.createRequest(owner, owned.id, { quantity: 1 })
  await stub.decideRequest(member, terminalIncoming.id, 'approve', {})
  const outgoing = await stub.createRequest(member, surviving.id, { quantity: 4 })
  const terminalOutgoing = await stub.createRequest(member, surviving.id, { quantity: 1 })
  await stub.decideRequest(owner, terminalOutgoing.id, 'approve', {})
  const unrelated = await stub.createRequest(neighbor, surviving.id, { quantity: 2 })
  const current = await photo(stub, member, owned.id), keep = await photo(stub, owner, surviving.id)
  await stub.flushSync()
  const orphan = `${id}/${owned.id}/${crypto.randomUUID()}`
  await env.BUCKET.put(orphan, 'non-current version')
  const other = cache()
  await other.stub.create(other.id, member, 'Another cache', false)
  await other.stub.flushSync()
  await stub.removeMember(owner, member)
  for (const call of [() => stub.detail(member), () => stub.listItems(member), () => stub.itemDetail(member, surviving.id), () => stub.itemRequests(member, surviving.id), () => stub.requestsForMember(member), () => stub.photoKey(member, surviving.id), () => stub.createRequest(member, surviving.id, { quantity: 1 }), () => stub.createItem(member, { title: 'Denied', is_consumable: false })]) await failure(call(), 'not_found')
  await failure(stub.join(member, secret), 'member_removed')
  await failure(stub.join(member, 'bad'), 'not_found')
  await failure(stub.itemDetail(owner, owned.id), 'not_found')
  const history = await stub.itemRequests(owner, surviving.id)
  expect(history.find(row => row.id === outgoing.id)).toMatchObject({ status: 'rejected', decision_reason: 'left the cache', decided_at: expect.any(Number) })
  expect(history.find(row => row.id === terminalOutgoing.id)?.status).toBe('approved')
  expect(history.find(row => row.id === unrelated.id)?.status).toBe('pending')
  expect((await stub.itemDetail(owner, surviving.id)).quantity).toBe(9)
  expect((await stub.updateItem(owner, surviving.id, { quantity: 2 })).quantity).toBe(2)
  const rows = await intents(stub), notifications = rows.filter(row => row.kind === 'notification').map(row => JSON.parse(row.payload))
  expect(notifications).toEqual([
    expect.objectContaining({ event: 'item_deleted', recipient_id: neighbor, request_id: incoming.id, item_title: owned.title, reason: 'left the cache' }),
    expect.objectContaining({ event: 'member_removed', recipient_id: member, request_id: outgoing.id, item_title: surviving.title, reason: 'left the cache' }),
  ])
  expect(rows.filter(row => row.kind === 'r2_delete_prefix').map(row => JSON.parse(row.payload).prefix)).toEqual([`${id}/${owned.id}/`])
  expect(await env.DB.prepare('SELECT 1 FROM my_caches WHERE user_id=? AND cache_id=?').bind(member, id).first()).not.toBeNull()
  expect((await aggregateRequests(env, member, null)).requests).toEqual([])
  expect(await env.BUCKET.head(current)).not.toBeNull()
  await stub.flushSync()
  expect(await env.DB.prepare('SELECT 1 FROM my_caches WHERE user_id=? AND cache_id=?').bind(member, id).first()).toBeNull()
  expect(await env.DB.prepare('SELECT 1 FROM my_caches WHERE user_id=? AND cache_id=?').bind(member, other.id).first()).not.toBeNull()
  expect(await env.BUCKET.head(current)).toBeNull()
  expect(await env.BUCKET.head(orphan)).toBeNull()
  expect(await env.BUCKET.head(keep)).not.toBeNull()
  await failure(stub.removeMember(owner, member), 'not_found')
  expect(await intents(stub)).toEqual([])
})

it('forbids removing the owner, non-owner self-leave and non-active targets without recording side effects', async () => {
  const { stub, owner, member, neighbor } = await created()
  await failure(stub.removeMember(owner, owner), 'owner_cannot_be_removed')
  for (const caller of [member, neighbor, 'outsider']) await failure(stub.removeMember(caller, member), 'not_found')
  await failure(stub.removeMember(owner, crypto.randomUUID()), 'not_found')
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("UPDATE members SET status='pending' WHERE user_id=?", neighbor) })
  await failure(stub.removeMember(owner, neighbor), 'not_found')
  expect(await intents(stub)).toEqual([])
  expect((await stub.detail(owner)).owner_id).toBe(owner)
})

it('rolls all local cascades and intents back when the last removal intent or item deletion fails', async () => {
  const { stub, owner, member, neighbor, owned, surviving } = await created()
  await stub.createRequest(neighbor, owned.id, { quantity: 2 })
  const outgoing = await stub.createRequest(member, surviving.id, { quantity: 3 })
  const key = await photo(stub, member, owned.id)
  await stub.flushSync()
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("CREATE TRIGGER fail_reverse BEFORE INSERT ON pending_sync WHEN NEW.kind='discovery_delete' BEGIN SELECT RAISE(ABORT, 'injected removal rollback'); END") })
  await failure(stub.removeMember(owner, member), 'injected removal rollback')
  expect((await stub.detail(member)).members.some(row => row.user_id === member)).toBe(true)
  expect(await stub.photoKey(member, owned.id)).toBe(key)
  expect((await stub.itemRequests(owner, surviving.id)).find(row => row.id === outgoing.id)?.status).toBe('pending')
  expect(await intents(stub)).toEqual([])
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec('DROP TRIGGER fail_reverse')
    state.storage.sql.exec("CREATE TRIGGER fail_item AFTER DELETE ON items BEGIN SELECT RAISE(ABORT, 'injected delete rollback'); END")
  })
  await failure(stub.deleteItem(member, owned.id), 'injected delete rollback')
  expect((await stub.itemRequests(member, owned.id))).toHaveLength(1)
  expect(await intents(stub)).toEqual([])
  expect(await env.BUCKET.head(key)).not.toBeNull()
})

it('bounds prefix cleanup to 100-key pages, retains the intent until empty and replays after external-delete/local-commit crashes', async () => {
  const { id, stub, owner, surviving } = await created()
  const current = await photo(stub, owner, surviving.id), prefix = `${id}/${surviving.id}/`
  const versions = Array.from({ length: 105 }, () => prefix + crypto.randomUUID())
  await Promise.all(versions.map(key => env.BUCKET.put(key, 'old version')))
  await stub.deleteItem(owner, surviving.id)
  const prefixIntent = (await intents(stub)).find(row => row.kind === 'r2_delete_prefix')!
  const deletion = env.BUCKET.delete.bind(env.BUCKET)
  const fail = vi.spyOn(env.BUCKET, 'delete').mockImplementation(async keys => {
    if (Array.isArray(keys)) throw new Error('injected prefix deletion failure')
    await deletion(keys)
  })
  await failure(stub.flushSync(), 'injected prefix deletion failure')
  expect(await env.BUCKET.head(current)).toBeNull()
  expect(await env.BUCKET.head(versions[0])).not.toBeNull()
  expect(await intents(stub)).toEqual([prefixIntent])
  await runInDurableObject(stub, async (_instance, state) => { expect(await state.storage.getAlarm()).not.toBeNull() })
  fail.mockRestore()
  const list = env.BUCKET.list.bind(env.BUCKET)
  const listed = vi.spyOn(env.BUCKET, 'list').mockImplementation(options => list(options))
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("CREATE TRIGGER fail_empty_commit BEFORE DELETE ON pending_sync WHEN OLD.kind='r2_delete_prefix' BEGIN SELECT RAISE(ABORT, 'injected empty-prefix commit failure'); END") })
  await failure(stub.flushSync(), 'injected empty-prefix commit failure')
  expect((await list({ prefix })).objects).toEqual([])
  expect(listed.mock.calls.map(call => call[0])).toEqual([{ prefix, limit: 100 }, { prefix, limit: 100 }, { prefix, limit: 100 }])
  expect(await intents(stub)).toEqual([prefixIntent])
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('DROP TRIGGER fail_empty_commit') })
  await abortAllDurableObjects()
  const restarted = cache(id).stub
  await restarted.flushSync()
  expect(await intents(restarted)).toEqual([])
})

it('keeps failed discovery removal durable and never authorizes through the stale reverse index', async () => {
  const { id, stub, owner, member, neighbor, owned } = await created()
  await stub.createRequest(neighbor, owned.id, { quantity: 2 })
  await stub.flushSync()
  await stub.removeMember(owner, member)
  const deletion = (await intents(stub)).find(row => row.kind === 'discovery_delete')!
  await env.DB.exec("CREATE TRIGGER fail_discovery_delete BEFORE DELETE ON my_caches BEGIN SELECT RAISE(ABORT, 'injected D1 removal failure'); END")
  await failure(stub.flushSync(), 'injected D1 removal failure')
  expect(await intents(stub)).toEqual([deletion])
  expect(await env.DB.prepare('SELECT 1 FROM my_caches WHERE user_id=? AND cache_id=?').bind(member, id).first()).not.toBeNull()
  expect((await aggregateRequests(env, member, null)).requests).toEqual([])
  await failure(stub.detail(member), 'not_found')
  await env.DB.exec('DROP TRIGGER fail_discovery_delete')
  expect(await runDurableObjectAlarm(stub)).toBe(true)
  expect(await intents(stub)).toEqual([])
  expect(await env.DB.prepare('SELECT 1 FROM my_caches WHERE user_id=? AND cache_id=?').bind(member, id).first()).toBeNull()
})

it('ordered replay cannot resurrect an older membership discovery intent after removal', async () => {
  const { id, stub, owner, secret } = await created(), newcomer = await user()
  await stub.join(newcomer, secret)
  await stub.createItem(newcomer, { title: 'New tool', is_consumable: false })
  await stub.removeMember(owner, newcomer)
  const discovery = (await intents(stub)).filter(row => row.kind.startsWith('discovery_'))
  expect(discovery.map(row => row.kind)).toEqual(['discovery_upsert', 'discovery_delete'])
  await Promise.all([stub.flushSync(), runDurableObjectAlarm(stub), stub.flushSync()])
  expect(await env.DB.prepare('SELECT 1 FROM my_caches WHERE user_id=? AND cache_id=?').bind(newcomer, id).first()).toBeNull()
  await failure(stub.join(newcomer, secret), 'member_removed')
})

it('request-vs-item-deletion races return 404 or include every successful request in the durable deletion snapshot', async () => {
  const { stub, member, neighbor } = await created()
  let successful = 0
  for (let index = 0; index < 12; index++) {
    const item = await stub.createItem(member, { title: `Race ${index}`, is_consumable: true, quantity: 1 })
    const create = () => Promise.resolve(stub.createRequest(neighbor, item.id, { quantity: 1 }))
    const remove = () => Promise.resolve(stub.deleteItem(member, item.id))
    const results = await Promise.allSettled(index % 2 ? [remove(), create()] : [create(), remove()])
    const created = results[index % 2 ? 1 : 0]
    const removed = results[index % 2 ? 0 : 1]
    expect(removed.status).toBe('fulfilled')
    if (created.status === 'fulfilled') {
      successful++
      const snapshots = (await intents(stub)).filter(row => row.kind === 'notification').map(row => JSON.parse(row.payload))
      expect(snapshots.filter(row => row.event === 'item_deleted' && row.request_id === created.value!.id)).toEqual([expect.objectContaining({ recipient_id: neighbor, item_title: item.title })])
    } else expect(created.reason.message).toContain('not_found')
    await failure(stub.itemDetail(member, item.id), 'not_found')
  }
  expect(successful).toBeGreaterThan(0)
})

it('request-vs-member-removal races cover both directions without silently losing committed requests', async () => {
  for (const removeFirst of [false, true]) {
    const { stub, owner, member, neighbor, owned, surviving } = await created()
    const outgoing = () => Promise.resolve(stub.createRequest(member, surviving.id, { quantity: 1 }))
    const incoming = () => Promise.resolve(stub.createRequest(neighbor, owned.id, { quantity: 1 }))
    const removal = () => Promise.resolve(stub.removeMember(owner, member))
    const results = await Promise.allSettled(removeFirst ? [removal(), outgoing(), incoming()] : [outgoing(), incoming(), removal()])
    expect(results[removeFirst ? 0 : 2].status).toBe('fulfilled')
    const notifications = (await intents(stub)).filter(row => row.kind === 'notification').map(row => JSON.parse(row.payload))
    for (const [offset, event] of [[removeFirst ? 1 : 0, 'member_removed'], [removeFirst ? 2 : 1, 'item_deleted']] as const) {
      const request = results[offset]
      if (request.status === 'fulfilled') expect(notifications.some(row => row.event === event && row.request_id === request.value!.id)).toBe(true)
      else expect(request.reason.message).toContain('not_found')
    }
    await failure(stub.requestsForMember(member), 'not_found')
  }
})

it('rejects late photo attachment after prefix cleanup and records a fresh exact-key cleanup intent', async () => {
  const { stub, member, owned } = await created()
  const late = await stub.photoUploadKey(member, owned.id)
  await stub.deleteItem(member, owned.id)
  await stub.flushSync()
  await env.BUCKET.put(late, 'late in-flight upload')
  expect(await stub.finishPhotoUpload(member, owned.id, late, true)).toBe(false)
  expect((await intents(stub)).map(row => ({ kind: row.kind, payload: row.payload }))).toEqual([{ kind: 'r2_delete', payload: JSON.stringify({ key: late }) }])
  await stub.flushSync()
  expect(await env.BUCKET.head(late)).toBeNull()
})

it('gates Worker destructive routes until D1 cascades ship, retaining Origin/profile protection', async () => {
  const caller = await login(), cacheId = crypto.randomUUID()
  const paths = [`/api/caches/${cacheId}/members/${caller.id}`, `/api/caches/${cacheId}/items/${crypto.randomUUID()}`]
  for (const path of paths) expect((await worker.fetch(appRequest(path, { method: 'DELETE', cookie: caller.cookie }), env)).status).toBe(409)
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: caller.cookie, body: { display_name: 'Neighbor' } }), env)
  for (const path of paths) {
    for (const origin of [null, 'null', 'https://foreign.test']) expect((await worker.fetch(appRequest(path, { method: 'DELETE', cookie: caller.cookie, origin }), env)).status).toBe(403)
    const response = await worker.fetch(appRequest(path, { method: 'DELETE', cookie: caller.cookie }), env)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'items_moving' })
  }
})
