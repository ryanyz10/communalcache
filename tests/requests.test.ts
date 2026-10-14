import { expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import worker from '../src/index'
import { aggregateRequests } from '../src/requests'
import { applyCacheIntent } from '../src/db'
import { appRequest, login } from './helpers'

async function user(name = 'Neighbor') {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?, ?, ?, 1, ?, ?, ?)')
    .bind(id, '', `${id}@example.test`, new Date().toISOString(), new Date().toISOString(), name).run()
  return id
}
function cache(id = crypto.randomUUID()) { return { id, stub: env.CACHES.get(env.CACHES.idFromName(id)) } }
async function created(quantity = 10) {
  const owner = await user('Owner'), member = await user('Requester'), neighbor = await user('Other neighbor')
  const { id, stub } = cache()
  const info = await stub.create(id, owner, 'Pantry', false)
  await stub.join(member, info.invite_token.split('.')[1])
  await stub.join(neighbor, info.invite_token.split('.')[1])
  const item = await stub.createItem(owner, { title: 'Sugar', is_consumable: true, quantity })
  const tool = await stub.createItem(member, { title: 'Mixer', is_consumable: false })
  await stub.flushSync()
  return { id, stub, owner, member, neighbor, item, tool }
}
async function failure(call: PromiseLike<unknown>, message: string) {
  let error: unknown
  try { await call } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain(message)
}
async function intents(stub: ReturnType<typeof cache>['stub']) {
  return runInDurableObject(stub, (_instance, state) => state.storage.sql.exec<{ id: string; payload: string }>("SELECT id,payload FROM pending_sync WHERE kind = 'notification' ORDER BY sequence").toArray())
}

it('many parallel requests never overbook and rejected creates leave no request or notification', async () => {
  const { stub, owner, member, item } = await created(9)
  const results = await Promise.allSettled(Array.from({ length: 30 }, () => Promise.resolve(stub.createRequest(member, item.id, { quantity: 2 }))))
  expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(4)
  expect(results.filter(row => row.status === 'rejected').every(row => row.reason.message.includes('insufficient_stock'))).toBe(true)
  const pending = await stub.itemRequests(owner, item.id)
  expect(pending.reduce((sum, row) => sum + row.quantity!, 0)).toBe(8)
  expect((await stub.itemDetail(owner, item.id)).quantity).toBe(9)
  expect(await intents(stub)).toHaveLength(4)
  await failure(stub.updateItem(owner, item.id, { quantity: 7 }), 'quantity_reserved')
  expect((await stub.updateItem(owner, item.id, { quantity: 8 })).quantity).toBe(8)
})

it('authorizes active non-owners and validates request quantity against item type without accepting forged parties', async () => {
  const { id, stub, owner, member, neighbor, item, tool } = await created()
  await failure(stub.createRequest(owner, item.id, { quantity: 1 }), 'not_found')
  for (const field of ['owner_id', 'requester_id']) await failure(stub.createRequest(member, item.id, { quantity: 1, [field]: neighbor }), 'not_found')
  for (const quantity of [undefined, null, 0, -1, 10000, 0.5, '1', true]) await failure(stub.createRequest(member, item.id, { quantity }), 'invalid_request_quantity')
  for (const quantity of [0, 1, '1', false]) await failure(stub.createRequest(owner, tool.id, { quantity }), 'invalid_request_quantity')
  expect(await stub.createRequest(owner, tool.id, { quantity: null })).toMatchObject({ quantity: null, requester_id: owner, owner_id: member, status: 'pending', cache_id: id })
  expect(await stub.createRequest(neighbor, tool.id, {})).toMatchObject({ quantity: null })
  for (const status of ['pending', 'removed']) {
    await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('UPDATE members SET status = ? WHERE user_id = ?', status, neighbor) })
    await failure(stub.createRequest(neighbor, item.id, { quantity: 1 }), 'not_found')
    await failure(stub.itemRequests(neighbor, item.id), 'not_found')
    await failure(stub.requestsForMember(neighbor), 'not_found')
  }
  await failure(stub.createRequest('outsider', item.id, { quantity: 1 }), 'not_found')
  await failure(stub.itemRequests(member, crypto.randomUUID()), 'not_found')
  await stub.updateItem(owner, item.id, { quantity: 0 })
  await failure(stub.createRequest(member, item.id, { quantity: 1 }), 'insufficient_stock')
})

it('concurrent approvals deduct stock exactly once and pending-only decisions return 409 conflicts thereafter', async () => {
  const { stub, owner, member, neighbor, item } = await created()
  const first = await stub.createRequest(member, item.id, { quantity: 3 })
  await stub.createRequest(neighbor, item.id, { quantity: 2 })
  const decisions = await Promise.allSettled(Array.from({ length: 15 }, () => Promise.resolve(stub.decideRequest(owner, first.id, 'approve', {}))))
  expect(decisions.filter(row => row.status === 'fulfilled')).toHaveLength(1)
  expect(decisions.filter(row => row.status === 'rejected').every(row => row.reason.message.includes('request_not_pending'))).toBe(true)
  expect((await stub.itemDetail(owner, item.id)).quantity).toBe(7)
  await failure(stub.decideRequest(owner, first.id, 'reject', { reason: 'Too late' }), 'request_not_pending')
  expect((await intents(stub)).map(row => JSON.parse(row.payload).event)).toEqual(['request_created', 'request_created', 'request_approved'])
})

it('approve versus reject has one winner, rejection releases stock reservations, and reusable approvals do not create quantities', async () => {
  const { stub, owner, member, item, tool } = await created(5)
  const request = await stub.createRequest(member, item.id, { quantity: 5 })
  const race = await Promise.allSettled([
    Promise.resolve(stub.decideRequest(owner, request.id, 'approve', {})),
    Promise.resolve(stub.decideRequest(owner, request.id, 'reject', { reason: 'Not available' })),
  ])
  expect(race.filter(row => row.status === 'fulfilled')).toHaveLength(1)
  expect((race.find(row => row.status === 'rejected') as PromiseRejectedResult).reason.message).toContain('request_not_pending')
  const won = (race.find(row => row.status === 'fulfilled') as PromiseFulfilledResult<{ status: string }>).value
  expect((await stub.itemDetail(owner, item.id)).quantity).toBe(won.status === 'approved' ? 0 : 5)
  await stub.updateItem(owner, item.id, { quantity: 5 })
  const rejected = await stub.createRequest(member, item.id, { quantity: 5 })
  await stub.decideRequest(owner, rejected.id, 'reject', { reason: '  Saving it for tomorrow  ' })
  const next = await stub.createRequest(member, item.id, { quantity: 5 })
  expect(next.status).toBe('pending')
  await failure(stub.decideRequest(owner, rejected.id, 'approve', {}), 'request_not_pending')
  const reusable = await stub.createRequest(owner, tool.id, {})
  await stub.decideRequest(member, reusable.id, 'approve', {})
  expect((await stub.itemDetail(member, tool.id)).quantity).toBeNull()
})

it('restock/create races preserve both writes or reject the unsafe edit/request without losing reservations', async () => {
  const { stub, owner, member, item } = await created()
  await Promise.all([stub.createRequest(member, item.id, { quantity: 5 }), stub.updateItem(owner, item.id, { quantity: 6, title: 'Brown sugar' })])
  expect(await stub.itemDetail(owner, item.id)).toMatchObject({ title: 'Brown sugar', quantity: 6 })
  await stub.updateItem(owner, item.id, { quantity: 10 })
  const results = await Promise.allSettled([
    Promise.resolve(stub.createRequest(member, item.id, { quantity: 4 })),
    Promise.resolve(stub.updateItem(owner, item.id, { quantity: 5 })),
  ])
  expect(results.filter(row => row.status === 'rejected')).toHaveLength(1)
  const stock = (await stub.itemDetail(owner, item.id)).quantity!
  const reserved = (await stub.itemRequests(owner, item.id)).filter(row => row.status === 'pending').reduce((sum, row) => sum + row.quantity!, 0)
  expect(stock).toBeGreaterThanOrEqual(reserved)
})

it('pending queues are member-public but decided rows and aggregates stay restricted to requester/item owner', async () => {
  const { stub, owner, member, neighbor, item } = await created()
  const request = await stub.createRequest(member, item.id, { quantity: 2 })
  expect(await stub.itemRequests(neighbor, item.id)).toEqual([request])
  expect(await stub.requestsForMember(neighbor)).toEqual([])
  for (const caller of [member, neighbor, 'outsider']) await failure(stub.decideRequest(caller, request.id, 'approve', {}), 'not_found')
  for (const reason of [undefined, null, '', '  ', 'x'.repeat(501), 123]) await failure(stub.decideRequest(owner, request.id, 'reject', { reason }), 'invalid_reason')
  const decided = await stub.decideRequest(owner, request.id, 'reject', { reason: 'No today' })
  expect(decided).toMatchObject({ status: 'rejected', decision_reason: 'No today', decided_at: expect.any(Number) })
  expect(await stub.itemRequests(neighbor, item.id)).toEqual([])
  expect(await stub.itemRequests(member, item.id)).toEqual([decided])
  expect(await stub.requestsForMember(owner)).toEqual([decided])
  const other = cache()
  await other.stub.create(other.id, owner, 'Other', false)
  await failure(other.stub.decideRequest(owner, request.id, 'approve', {}), 'not_found')
})

it('rolls request, decision, stock and notification intents back together and re-arms pending work on all new entry points', async () => {
  const { stub, owner, member, item } = await created()
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("CREATE TRIGGER fail_notification BEFORE INSERT ON pending_sync WHEN NEW.kind = 'notification' BEGIN SELECT RAISE(ABORT, 'injected request intent failure'); END") })
  await failure(stub.createRequest(member, item.id, { quantity: 3 }), 'injected request intent failure')
  expect(await stub.itemRequests(owner, item.id)).toEqual([])
  expect(await intents(stub)).toEqual([])
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('DROP TRIGGER fail_notification') })
  const request = await stub.createRequest(member, item.id, { quantity: 3 })
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("CREATE TRIGGER fail_notification BEFORE INSERT ON pending_sync WHEN NEW.kind = 'notification' BEGIN SELECT RAISE(ABORT, 'injected request intent failure'); END") })
  for (const decision of ['approve', 'reject'] as const) await failure(stub.decideRequest(owner, request.id, decision, { reason: 'No' }), 'injected request intent failure')
  expect((await stub.itemDetail(owner, item.id)).quantity).toBe(10)
  expect((await stub.itemRequests(owner, item.id))[0].status).toBe('pending')
  expect(await intents(stub)).toHaveLength(1)
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('DROP TRIGGER fail_notification') })
  for (const call of [() => stub.itemRequests(member, item.id), () => stub.requestsForMember(member), () => stub.createRequest(member, item.id, { quantity: 1 }), () => stub.decideRequest(owner, request.id, 'reject', { reason: 'No' })]) {
    await runInDurableObject(stub, async (_instance, state) => { await state.storage.deleteAlarm() })
    await call()
    await runInDurableObject(stub, async (_instance, state) => { expect(await state.storage.getAlarm()).not.toBeNull() })
  }
})

it('snapshots notification recipients/title/quantity/reason and fills stable outbox IDs idempotently without sending', async () => {
  const { stub, owner, member, item } = await created()
  const request = await stub.createRequest(member, item.id, { quantity: 2 })
  await stub.decideRequest(owner, request.id, 'reject', { reason: '  Keeping it  ' })
  const recorded = await intents(stub)
  expect(recorded.map(row => JSON.parse(row.payload))).toEqual([
    expect.objectContaining({ event: 'request_created', recipient_id: owner, user_id: member, item_title: 'Sugar', quantity: 2, request_id: request.id }),
    expect.objectContaining({ event: 'request_rejected', recipient_id: member, reason: 'Keeping it', item_title: 'Sugar', request_id: request.id }),
  ])
  expect(JSON.stringify(recorded)).not.toContain('example.test')
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON pending_sync WHEN OLD.kind = 'notification' BEGIN SELECT RAISE(ABORT, 'injected outbox crash'); END") })
  await failure(stub.flushSync(), 'injected outbox crash')
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('DROP TRIGGER fail_delete') })
  await stub.flushSync()
  const outbox = await env.DB.prepare('SELECT id,kind,payload FROM outbox ORDER BY created_at,id').all<{ id: string; kind: string; payload: string }>()
  expect(outbox.results.map(row => row.id).sort()).toEqual(recorded.map(row => row.id).sort())
  expect(await intents(stub)).toEqual([])
})

it('keeps requests immediately usable while joining discovery lags, then discovers them through ordered sync', async () => {
  const { stub, owner, item } = await created()
  const newcomer = await user('New neighbor')
  const secret = (await stub.detail(owner)).invite_token.split('.')[1]
  await stub.join(newcomer, secret)
  const request = await stub.createRequest(newcomer, item.id, { quantity: 1 })
  expect(await stub.requestsForMember(newcomer)).toEqual([request])
  expect((await aggregateRequests(env, newcomer, null)).requests).toEqual([])
  await stub.flushSync()
  expect((await aggregateRequests(env, newcomer, null)).requests.map(row => row.id)).toEqual([request.id])
})

it('discovers only caller my_caches and never grants access from missing/stale/forged discovery projections', async () => {
  const { id, stub, owner, member, item } = await created()
  const request = await stub.createRequest(member, item.id, { quantity: 1 })
  expect((await aggregateRequests(env, member, null)).requests.map(row => row.id)).toEqual([request.id])
  await env.DB.prepare('DELETE FROM my_caches WHERE user_id = ? AND cache_id = ?').bind(member, id).run()
  expect((await aggregateRequests(env, member, null)).requests).toEqual([])
  expect(await stub.requestsForMember(member)).toEqual([request])
  await applyCacheIntent(env.DB, 'discovery_upsert', JSON.stringify({ cache_id: id, user_id: member }))
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("UPDATE members SET status = 'removed' WHERE user_id = ?", member) })
  expect((await aggregateRequests(env, member, null)).requests).toEqual([])
  expect((await aggregateRequests(env, owner, null)).requests).toHaveLength(1)
  const foreign = cache()
  await foreign.stub.create(foreign.id, owner, 'Registry only', false)
  await foreign.stub.flushSync()
  expect((await aggregateRequests(env, member, null)).requests).toEqual([])
})

it('bounds discovery to 25 caches with continuation, skips stale 404s and reports failed RPCs as unavailable', async () => {
  const caller = await user(), ids = Array.from({ length: 27 }, () => crypto.randomUUID()).sort()
  for (const id of ids) {
    const { stub } = cache(id)
    await stub.create(id, caller, 'Cache', false)
    await stub.flushSync()
  }
  await runInDurableObject(cache(ids[0]).stub, (_instance, state) => { state.storage.sql.exec('DROP TABLE requests') })
  await runInDurableObject(cache(ids[25]).stub, (_instance, state) => { state.storage.sql.exec('DROP TABLE requests') })
  const first = await aggregateRequests(env, caller, null)
  expect(first.next_cursor).toBe(ids[24])
  expect(first.unavailable_cache_ids).toEqual([ids[0]])
  expect(first.requests).toEqual([])
  const second = await aggregateRequests(env, caller, first.next_cursor)
  expect(second.next_cursor).toBeNull()
  expect(second.unavailable_cache_ids).toEqual([ids[25]])
  await runInDurableObject(cache(ids[26]).stub, (_instance, state) => { state.storage.sql.exec("UPDATE members SET role='member', status='removed' WHERE user_id=?", caller) })
  const stale = await aggregateRequests(env, caller, ids[25])
  expect(stale).toEqual({ requests: [], unavailable_cache_ids: [], next_cursor: null })
})

it('limits concurrent aggregation RPCs to five while still reading real local DO data', async () => {
  const { owner } = await created()
  for (let index = 0; index < 8; index++) {
    const { id, stub } = cache()
    await stub.create(id, owner, 'Discovery', false)
    await stub.flushSync()
  }
  let running = 0, peak = 0, calls = 0
  const get = env.CACHES.get.bind(env.CACHES)
  const wrapped = { ...env, CACHES: { idFromName: env.CACHES.idFromName.bind(env.CACHES), get: (id: DurableObjectId) => ({ requestsForMember: async (userId: string) => {
    calls++; running++; peak = Math.max(peak, running)
    try { return await get(id).requestsForMember(userId) }
    finally { running-- }
  } }) } } as unknown as Env
  await aggregateRequests(wrapped, owner, null)
  expect(peak).toBe(5)
  expect(calls).toBe(9)
})

it('Worker routes enforce profiles, CSRF, quantities, owner decisions, public names and bounded cursor validation', async () => {
  const owner = await login('owner@example.test')
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: owner.cookie, body: { display_name: 'Owner' } }), env)
  const { id, stub } = cache()
  const info = await stub.create(id, owner.id, 'Pantry', false)
  const item = await stub.createItem(owner.id, { title: 'Sugar', is_consumable: true, quantity: 5 })
  const caller = await login('requester@example.test')
  const path = `/api/caches/${id}/items/${item.id}/requests`
  const post = (body: unknown, cookie = caller.cookie) => worker.fetch(appRequest(path, { method: 'POST', cookie, body }), env)
  expect((await post({ quantity: 1 })).status).toBe(409)
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: caller.cookie, body: { display_name: 'Requester' } }), env)
  expect((await post({ quantity: 1 })).status).toBe(404)
  await stub.join(caller.id, info.invite_token.split('.')[1])
  for (const origin of [null, 'null', 'https://foreign.test']) expect((await worker.fetch(appRequest(path, { method: 'POST', cookie: caller.cookie, origin, body: { quantity: 1 } }), env)).status).toBe(403)
  expect((await post({ quantity: 0 })).status).toBe(400)
  expect((await post({ quantity: 6 })).status).toBe(409)
  const response = await post({ quantity: 2 })
  expect(response.status).toBe(201)
  const request = await response.json() as { id: string }
  expect(request).toMatchObject({ requester_id: caller.id, requester_name: 'Requester', owner_name: 'Owner' })
  const decision = `/api/caches/${id}/requests/${request.id}`
  expect((await worker.fetch(appRequest(decision + '/approve', { method: 'POST', cookie: caller.cookie, body: {} }), env)).status).toBe(404)
  expect((await worker.fetch(appRequest(decision + '/reject', { method: 'POST', cookie: owner.cookie, body: { reason: '' } }), env)).status).toBe(400)
  for (const action of ['approve', 'reject']) for (const origin of [null, 'null', 'https://foreign.test']) expect((await worker.fetch(appRequest(decision + '/' + action, { method: 'POST', cookie: owner.cookie, origin, body: { reason: 'No' } }), env)).status).toBe(403)
  expect((await worker.fetch(appRequest(decision + '/approve', { method: 'POST', cookie: owner.cookie, body: {} }), env)).status).toBe(200)
  expect((await worker.fetch(appRequest(decision + '/reject', { method: 'POST', cookie: owner.cookie, body: { reason: 'No' } }), env)).status).toBe(409)
  expect((await worker.fetch(appRequest(decision + '/cancel', { method: 'POST', cookie: caller.cookie, body: {} }), env)).status).toBe(404)
  expect((await worker.fetch(appRequest('/api/requests?after=bad', { cookie: caller.cookie }), env)).status).toBe(400)
  await stub.flushSync()
  const all = await worker.fetch(appRequest('/api/requests', { cookie: caller.cookie }), env)
  const payload = await all.json()
  expect(JSON.stringify(payload)).not.toContain('example.test')
  expect(payload).toMatchObject({ requests: [{ id: request.id, status: 'approved' }], unavailable_cache_ids: [], next_cursor: null })
  const queue = await worker.fetch(appRequest(path, { cookie: caller.cookie }), env)
  expect(queue.status).toBe(200)
  expect(JSON.stringify(await queue.json())).not.toContain('example.test')
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("UPDATE members SET status = 'removed' WHERE user_id = ?", caller.id) })
  expect((await worker.fetch(appRequest(path, { cookie: caller.cookie }), env)).status).toBe(404)
  expect((await post({ quantity: 1 })).status).toBe(404)
})
