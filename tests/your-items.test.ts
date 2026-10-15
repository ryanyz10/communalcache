import { expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import worker from '../src/index'
import { aggregateOwnedItems } from '../src/items'
import { applyCacheIntent } from '../src/db'
import type { OwnedItemInfo } from '../src/cache'
import { appRequest, login } from './helpers'

async function user(name = 'Neighbor') {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?, ?, ?, 1, ?, ?, ?)')
    .bind(id, '', `${id}@example.test`, new Date().toISOString(), new Date().toISOString(), name).run()
  return id
}
function cache(id = crypto.randomUUID()) { return { id, stub: env.CACHES.get(env.CACHES.idFromName(id)) } }
async function created(callerId?: string) {
  const caller = callerId ?? await user()
  const admin = await user('Cache owner'), neighbor = await user('Other member')
  const { id, stub } = cache()
  const info = await stub.create(id, admin, 'Pantry', false)
  await stub.join(caller, info.invite_token.split('.')[1])
  await stub.join(neighbor, info.invite_token.split('.')[1])
  const own = await stub.createItem(caller, { title: 'Starter', is_consumable: true, quantity: 10 })
  const other = await stub.createItem(neighbor, { title: 'Private other item', is_consumable: false })
  await stub.flushSync()
  return { id, stub, admin, caller, neighbor, own, other }
}
async function failure(call: PromiseLike<unknown>, message: string) {
  let error: unknown
  try { await call } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain(message)
}

it('returns only the caller-owned items across discovered caches with live names, stock, pending counts and private photo versions', async () => {
  const { id, stub, admin, caller, neighbor, own, other } = await created()
  await stub.createRequest(neighbor, own.id, { quantity: 2 })
  await stub.createRequest(admin, own.id, { quantity: 1 })
  const decided = await stub.createRequest(neighbor, own.id, { quantity: 3 })
  await stub.decideRequest(caller, decided.id, 'approve', {})
  const key = await stub.photoUploadKey(caller, own.id)
  await env.BUCKET.put(key, new Uint8Array([1, 2, 3]))
  await stub.finishPhotoUpload(caller, own.id, key, true)
  await stub.update(admin, { name: 'Renamed pantry' })
  const second = cache()
  await second.stub.create(second.id, caller, 'Tools', false)
  const tool = await second.stub.createItem(caller, { title: 'Ladder', is_consumable: false })
  await second.stub.flushSync()
  const result = await aggregateOwnedItems(env, caller, null)
  expect(result.items.map(item => item.id).sort()).toEqual([own.id, tool.id].sort())
  expect(result.items).not.toContainEqual(expect.objectContaining({ id: other.id }))
  expect(result.items.find(item => item.id === own.id)).toMatchObject({ cache_id: id, cache_name: 'Renamed pantry', owner_id: caller, title: 'Starter', is_consumable: true, quantity: 7, pending_request_count: 2, photo_version: key.split('/').at(-1) })
  expect(result.items.find(item => item.id === tool.id)).toMatchObject({ cache_name: 'Tools', quantity: null, is_consumable: false, pending_request_count: 0, photo_version: null })
  expect(result.unavailable_cache_ids).toEqual([])
  expect(result.next_cursor).toBeNull()
  const serialized = JSON.stringify(result)
  for (const privateValue of [key, 'photo_path', 'invite_token', 'email', 'example.test', other.title]) expect(serialized).not.toContain(privateValue)
})

it('checks active membership in the owner-filtered DO read, including when old owned rows still exist', async () => {
  const { stub, admin, caller, neighbor, own, other } = await created()
  expect((await stub.itemsForOwner(caller)).map(item => item.id)).toEqual([own.id])
  expect((await stub.itemsForOwner(neighbor)).map(item => item.id)).toEqual([other.id])
  expect(await stub.itemsForOwner(admin)).toEqual([])
  await failure(stub.itemsForOwner('outsider'), 'not_found')
  for (const status of ['pending', 'removed']) {
    await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('UPDATE members SET status=? WHERE user_id=?', status, caller) })
    await failure(stub.itemsForOwner(caller), 'not_found')
    await runInDurableObject(stub, (_instance, state) => { expect(state.storage.sql.exec('SELECT id FROM items WHERE owner_id=?', caller).one().id).toBe(own.id) })
  }
})

it('uses only caller my_caches for discovery and never authorizes from missing, stale or forged index rows', async () => {
  const { id, stub, caller, own } = await created()
  await env.DB.prepare('DELETE FROM my_caches WHERE user_id=? AND cache_id=?').bind(caller, id).run()
  expect(await aggregateOwnedItems(env, caller, null)).toEqual({ items: [], unavailable_cache_ids: [], next_cursor: null })
  expect((await stub.itemsForOwner(caller))[0].id).toBe(own.id)
  await applyCacheIntent(env.DB, 'discovery_upsert', JSON.stringify({ user_id: caller, cache_id: id }))
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("UPDATE members SET status='removed' WHERE user_id=?", caller) })
  expect((await aggregateOwnedItems(env, caller, null)).items).toEqual([])
  const outsider = await user()
  await applyCacheIntent(env.DB, 'discovery_upsert', JSON.stringify({ user_id: outsider, cache_id: id }))
  expect(await aggregateOwnedItems(env, outsider, null)).toEqual({ items: [], unavailable_cache_ids: [], next_cursor: null })
  const registryOnly = cache()
  await registryOnly.stub.create(registryOnly.id, outsider, 'Registry only', false)
  await registryOnly.stub.createItem(outsider, { title: 'Not discovered', is_consumable: false })
  await registryOnly.stub.flushSync()
  await env.DB.prepare('DELETE FROM my_caches WHERE user_id=? AND cache_id=?').bind(outsider, registryOnly.id).run()
  expect((await aggregateOwnedItems(env, outsider, null)).items).toEqual([])
})

it('bounds discovery to 25 caches with continuation and explicit unavailable states, while skipping removed-member 404 drift', async () => {
  const caller = await user(), ids = Array.from({ length: 27 }, () => crypto.randomUUID()).sort()
  for (const id of ids) {
    const { stub } = cache(id)
    await stub.create(id, caller, 'Cache', false)
    await stub.createItem(caller, { title: id, is_consumable: false })
    await stub.flushSync()
  }
  await runInDurableObject(cache(ids[0]).stub, (_instance, state) => { state.storage.sql.exec('DROP TABLE requests') })
  await runInDurableObject(cache(ids[25]).stub, (_instance, state) => { state.storage.sql.exec('DROP TABLE requests') })
  const first = await aggregateOwnedItems(env, caller, null)
  expect(first.items).toHaveLength(24)
  expect(first.next_cursor).toBe(ids[24])
  expect(first.unavailable_cache_ids).toEqual([ids[0]])
  const second = await aggregateOwnedItems(env, caller, first.next_cursor)
  expect(second.items).toHaveLength(1)
  expect(second.next_cursor).toBeNull()
  expect(second.unavailable_cache_ids).toEqual([ids[25]])
  await runInDurableObject(cache(ids[26]).stub, (_instance, state) => { state.storage.sql.exec("UPDATE members SET role='member',status='removed' WHERE user_id=?", caller) })
  expect(await aggregateOwnedItems(env, caller, ids[25])).toEqual({ items: [], unavailable_cache_ids: [], next_cursor: null })
})

it('limits concurrent aggregation RPCs to five while reading real local DO data', async () => {
  const caller = await user()
  for (let index = 0; index < 9; index++) {
    const { id, stub } = cache()
    await stub.create(id, caller, 'Tools', false)
    await stub.createItem(caller, { title: 'Item', is_consumable: false })
    await stub.flushSync()
  }
  let running = 0, peak = 0, calls = 0
  const get = env.CACHES.get.bind(env.CACHES)
  const wrapped = { ...env, CACHES: { idFromName: env.CACHES.idFromName.bind(env.CACHES), get: (id: DurableObjectId) => ({ itemsForOwner: async (userId: string) => {
    calls++; running++; peak = Math.max(peak, running)
    try { return await get(id).itemsForOwner(userId) } finally { running-- }
  } }) } } as unknown as Env
  expect((await aggregateOwnedItems(wrapped, caller, null)).items).toHaveLength(9)
  expect(peak).toBe(5)
  expect(calls).toBe(9)
})

it('Worker authenticates the caller, requires profile completion, validates cursors and never accepts a forged owner', async () => {
  const caller = await login()
  expect((await worker.fetch(appRequest('/api/me/items'), env)).status).toBe(401)
  const incomplete = await worker.fetch(appRequest('/api/me/items', { cookie: caller.cookie }), env)
  expect(incomplete.status).toBe(409)
  expect(await incomplete.json()).toEqual({ error: 'profile_incomplete' })
  expect((await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: caller.cookie, body: { display_name: 'Neighbor' } }), env)).status).toBe(200)
  const { id, stub, own, neighbor, other } = await created(caller.id)
  const result = await worker.fetch(appRequest(`/api/me/items?owner_id=${neighbor}&user_id=${neighbor}`, { cookie: caller.cookie, origin: null }), env)
  expect(result.status).toBe(200)
  expect(result.headers.get('Cache-Control')).toBe('no-store')
  const payload = await result.json() as { items: OwnedItemInfo[] }
  expect(payload.items.map(item => item.id)).toEqual([own.id])
  expect(JSON.stringify(payload)).not.toContain('example.test')
  expect(JSON.stringify(payload)).not.toContain(other.title)
  expect((await worker.fetch(appRequest('/api/me/items?after=bad', { cookie: caller.cookie }), env)).status).toBe(400)
  const upper = await worker.fetch(appRequest(`/api/me/items?after=${id.toUpperCase()}`, { cookie: caller.cookie }), env)
  expect(upper.status).toBe(200)
  expect((await worker.fetch(appRequest('/api/me/items', { method: 'POST', cookie: caller.cookie, body: {} }), env)).status).toBe(405)
  expect((await worker.fetch(appRequest('/api/me/items', { method: 'POST', cookie: caller.cookie, origin: null, body: {} }), env)).status).toBe(403)
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("UPDATE members SET status='removed' WHERE user_id=?", caller.id) })
  expect(await (await worker.fetch(appRequest('/api/me/items', { cookie: caller.cookie }), env)).json()).toEqual({ items: [], unavailable_cache_ids: [], next_cursor: null })
})

it('re-arms existing pending sync on the new RPC without creating domain state or notification intents', async () => {
  const { id, stub } = cache(), caller = await user()
  await stub.create(id, caller, 'Tools', false)
  await runInDurableObject(stub, async (_instance, state) => { await state.storage.deleteAlarm() })
  expect(await stub.itemsForOwner(caller)).toEqual([])
  await runInDurableObject(stub, async (_instance, state) => {
    expect(await state.storage.getAlarm()).not.toBeNull()
    expect(state.storage.sql.exec('SELECT kind FROM pending_sync ORDER BY sequence').toArray().map(row => row.kind)).toEqual(['registry_upsert', 'discovery_upsert'])
    expect(state.storage.sql.exec('SELECT 1 FROM items').toArray()).toEqual([])
  })
})
