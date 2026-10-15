import { it, expect } from 'vitest'
import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import worker from '../src/index'
import { appRequest, login } from './helpers'

function cache(id = crypto.randomUUID()) { return { id, stub: env.CACHES.get(env.CACHES.idFromName(id)) } }
async function created() {
  const { id, stub } = cache()
  await stub.create(id, 'cache-owner', 'Tools', false)
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec("INSERT INTO members VALUES ('owner','member','active',1), ('member','member','active',1), ('pending','member','pending',1), ('removed','member','removed',1)")
  })
  const item = await stub.createItem('owner', { title: 'Mixer', is_consumable: false })
  return { id, stub, item }
}
async function failure(call: PromiseLike<unknown>, message: string) {
  let error: unknown
  try { await call } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain(message)
}

it('active members create/list/read items and only the active item owner edits, including against the cache owner', async () => {
  const { stub, item } = await created()
  for (const caller of ['cache-owner', 'owner', 'member']) {
    expect(await stub.listItems(caller)).toEqual([item])
    expect(await stub.itemDetail(caller, item.id)).toEqual(item)
  }
  for (const caller of ['outsider', 'pending', 'removed']) {
    await failure(stub.listItems(caller), 'not_found')
    await failure(stub.itemDetail(caller, item.id), 'not_found')
    await failure(stub.createItem(caller, { title: 'Forbidden', is_consumable: false }), 'not_found')
    await failure(stub.updateItem(caller, item.id, { title: 'Forbidden' }), 'not_found')
  }
  for (const caller of ['cache-owner', 'member']) await failure(stub.updateItem(caller, item.id, { title: 'Forbidden' }), 'not_found')
  expect(await stub.updateItem('owner', item.id, { title: '  Stand mixer  ', description: '  Happy to share  ' })).toMatchObject({ title: 'Stand mixer', description: 'Happy to share', owner_id: 'owner', quantity: null, is_consumable: false })
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("UPDATE members SET status = 'removed' WHERE user_id = 'owner'") })
  await failure(stub.updateItem('owner', item.id, { title: 'Removed' }), 'not_found')
})

it('keeps UUID items local to their cache and never accepts forged ownership on create or edit', async () => {
  const { id, stub, item } = await created()
  expect(item.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(item.cache_id).toBe(id)
  await failure(stub.createItem('owner', { title: 'Forged', is_consumable: false, owner_id: 'member' }), 'not_found')
  await failure(stub.updateItem('owner', item.id, { title: 'Forged', owner_id: 'member' }), 'not_found')
  const other = cache()
  await other.stub.create(other.id, 'owner', 'Other', false)
  await failure(other.stub.itemDetail('owner', item.id), 'not_found')
  await failure(other.stub.updateItem('owner', item.id, { title: 'Wrong cache' }), 'not_found')
  await failure(stub.itemDetail('owner', crypto.randomUUID()), 'not_found')
  expect(await stub.listItems('owner')).toEqual([item])
})

it('allows zero and bounded integer consumable stock, null-only non-consumables, and immutable item types', async () => {
  const { stub, item } = await created()
  const empty = await stub.createItem('member', { title: 'Sugar', is_consumable: true, quantity: 0, description: null })
  expect(empty).toMatchObject({ owner_id: 'member', is_consumable: true, quantity: 0, description: null, created_at: expect.any(Number) })
  expect(await stub.updateItem('member', empty.id, { quantity: 9999 })).toMatchObject({ quantity: 9999 })
  expect(await stub.updateItem('member', empty.id, { quantity: 0 })).toMatchObject({ quantity: 0 })
  expect(await stub.createItem('owner', { title: 'Drill', is_consumable: false, quantity: null })).toMatchObject({ quantity: null })
  expect(await stub.updateItem('owner', item.id, { quantity: null })).toMatchObject({ quantity: null })
  for (const quantity of [undefined, null, -1, 10000, 0.5, '1', true]) {
    await failure(stub.createItem('member', { title: 'Sugar', is_consumable: true, quantity }), 'invalid_quantity')
    await failure(stub.updateItem('member', empty.id, { quantity }), 'invalid_quantity')
  }
  for (const quantity of [0, 1, '1', false]) {
    await failure(stub.createItem('owner', { title: 'Drill', is_consumable: false, quantity }), 'invalid_quantity')
    await failure(stub.updateItem('owner', item.id, { quantity }), 'invalid_quantity')
  }
  for (const is_consumable of [true, false, null, 'yes']) {
    await failure(stub.updateItem('owner', item.id, { is_consumable }), 'immutable_is_consumable')
    await failure(stub.updateItem('member', empty.id, { is_consumable }), 'immutable_is_consumable')
  }
  for (const is_consumable of [undefined, 0, 1, null, 'true']) await failure(stub.createItem('owner', { title: 'Drill', is_consumable }), 'invalid_is_consumable')
})

it('validates and trims bounded text without partial edits or SQL interpolation', async () => {
  const { stub, item } = await created()
  for (const title of ['', '  ', 'x'.repeat(121), null, 3]) {
    await failure(stub.createItem('owner', { title, is_consumable: false }), 'invalid_title')
    await failure(stub.updateItem('owner', item.id, { title }), 'invalid_title')
  }
  for (const description of ['x'.repeat(2001), 1, true, {}]) {
    await failure(stub.createItem('owner', { title: 'Drill', is_consumable: false, description }), 'invalid_description')
    await failure(stub.updateItem('owner', item.id, { title: 'Lost edit', description }), 'invalid_description')
  }
  await failure(stub.updateItem('owner', item.id, {}), 'invalid_json')
  await failure(stub.updateItem('owner', item.id, { unknown: true }), 'invalid_json')
  expect(await stub.itemDetail('owner', item.id)).toEqual(item)
  const boundary = await stub.createItem('owner', { title: '😀'.repeat(120), description: '😀'.repeat(2000), is_consumable: false })
  expect([...boundary.title]).toHaveLength(120)
  expect([...boundary.description!]).toHaveLength(2000)
  const sqlText = "Mixer'); DROP TABLE items; --"
  expect(await stub.updateItem('owner', item.id, { title: sqlText, description: '   ' })).toMatchObject({ title: sqlText, description: null })
  expect(await stub.listItems('owner')).toHaveLength(2)
})

it('checks pending reservation sums in the edit transaction, allows the floor/restock, and ignores terminal requests', async () => {
  const { stub } = await created()
  const item = await stub.createItem('owner', { title: 'Sugar', is_consumable: true, quantity: 10 })
  await runInDurableObject(stub, (_instance, state) => {
    for (const [id, quantity, status, reason, decided] of [
      ['pending-a', 3, 'pending', null, null], ['pending-b', 2, 'pending', null, null],
      ['approved', 99, 'approved', null, 1], ['rejected', 99, 'rejected', 'No', 1],
    ] as const) {
      state.storage.sql.exec('INSERT INTO requests VALUES (?, ?, ?, ?, ?, ?, ?, 1)', id, item.id, 'member', quantity, status, reason, decided)
    }
  })
  await failure(stub.updateItem('owner', item.id, { title: 'Lost edit', quantity: 4 }), 'quantity_reserved')
  expect(await stub.itemDetail('owner', item.id)).toEqual(item)
  expect(await stub.updateItem('owner', item.id, { quantity: 5 })).toMatchObject({ quantity: 5 })
  expect(await stub.updateItem('owner', item.id, { quantity: 9999 })).toMatchObject({ quantity: 9999 })
  const results = await Promise.allSettled([4, 6, 7].map(quantity => Promise.resolve(stub.updateItem('owner', item.id, { quantity }))))
  expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(2)
  expect((results.find(row => row.status === 'rejected') as PromiseRejectedResult).reason.message).toContain('quantity_reserved')
  expect((await stub.itemDetail('owner', item.id)).quantity).toBeGreaterThanOrEqual(5)
  await Promise.all([stub.updateItem('owner', item.id, { title: 'Brown sugar' }), stub.updateItem('owner', item.id, { quantity: 9 })])
  expect(await stub.itemDetail('owner', item.id)).toMatchObject({ title: 'Brown sugar', quantity: 9 })
})

it('rolls back thrown item mutations without new cross-store work, and item entry points re-arm existing work', async () => {
  const { stub, item } = await created()
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec("CREATE TRIGGER fail_create BEFORE INSERT ON items BEGIN SELECT RAISE(ABORT, 'injected item failure'); END")
    state.storage.sql.exec("CREATE TRIGGER fail_update AFTER UPDATE ON items BEGIN SELECT RAISE(ABORT, 'injected item failure'); END")
  })
  await failure(stub.createItem('owner', { title: 'Lost', is_consumable: false }), 'injected item failure')
  await failure(stub.updateItem('owner', item.id, { title: 'Lost' }), 'injected item failure')
  expect(await stub.listItems('owner')).toEqual([item])
  await runInDurableObject(stub, (_instance, state) => {
    expect(state.storage.sql.exec('SELECT 1 FROM pending_sync').toArray()).toHaveLength(2)
    state.storage.sql.exec('DROP TRIGGER fail_create; DROP TRIGGER fail_update')
  })
  for (const call of [
    () => stub.listItems('owner'), () => stub.itemDetail('owner', item.id),
    () => stub.createItem('owner', { title: 'Drill', is_consumable: false }),
    () => stub.updateItem('owner', item.id, { title: 'Updated' }),
  ]) {
    await runInDurableObject(stub, async (_instance, state) => { await state.storage.deleteAlarm() })
    await call()
    await runInDurableObject(stub, async (_instance, state) => { expect(await state.storage.getAlarm()).not.toBeNull() })
  }
})

it('retains cookie, Origin/profile protection and non-member 404 on reopened Worker item routes', async () => {
  const caller = await login(), path = `/api/caches/${crypto.randomUUID()}/items`
  expect((await worker.fetch(appRequest(path, { method: 'POST', body: {} }), env)).status).toBe(401)
  expect((await worker.fetch(appRequest(path, { method: 'POST', cookie: caller.cookie, body: {} }), env)).status).toBe(409)
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: caller.cookie, body: { display_name: 'Neighbor' } }), env)
  for (const origin of [null, 'null', 'https://foreign.test']) expect((await worker.fetch(appRequest(path, { method: 'POST', cookie: caller.cookie, origin, body: {} }), env)).status).toBe(403)
  expect((await worker.fetch(appRequest(path, { method: 'POST', cookie: caller.cookie, body: { title: 'Mixer', is_consumable: false } }), env)).status).toBe(404)
  expect((await worker.fetch(appRequest(path, { cookie: caller.cookie }), env)).status).toBe(404)
})
