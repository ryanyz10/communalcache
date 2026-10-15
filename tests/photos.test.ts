import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { abortAllDurableObjects, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test'
import worker from '../src/index'
import { MAX_PHOTO_BYTES } from '../src/photos'
import { appRequest, base, login } from './helpers'

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/f9sAAAAASUVORK5CYII='), char => char.charCodeAt(0))
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 2, 255, 217])
const webp = new Uint8Array([82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 0, 0, 0, 0])

async function created() {
  const caller = await login()
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: caller.cookie, body: { display_name: 'Neighbor' } }), env)
  const cacheOwner = crypto.randomUUID(), id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?, ?, ?, 1, ?, ?, ?)')
    .bind(cacheOwner, '', `${cacheOwner}@example.test`, new Date().toISOString(), new Date().toISOString(), 'Cache owner').run()
  const stub = env.CACHES.get(env.CACHES.idFromName(id))
  await stub.create(id, cacheOwner, 'Tools', false)
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("INSERT INTO members VALUES (?, 'member', 'active', 1)", caller.id) })
  const item = await stub.createItem(caller.id, { title: 'Mixer', is_consumable: false })
  await stub.flushSync()
  const path = `/api/caches/${id}/items/${item.id}/photo`
  return { caller, cacheOwner, id, stub, item, path }
}
function upload(path: string, cookie: string, bytes: BodyInit = png, type = 'image/png', headers: Record<string, string> = {}) {
  return new Request(base + path, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': type, ...headers }, body: bytes })
}
async function failure(call: PromiseLike<unknown>, message: string) {
  let error: unknown
  try { await call } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain(message)
}
async function cleanup(stub: DurableObjectStub<import('../src/cache').Cache>) {
  return runInDurableObject(stub, (_instance, state) => state.storage.sql.exec<{ id: string; payload: string }>("SELECT id, payload FROM pending_sync WHERE kind = 'r2_delete' ORDER BY sequence").toArray())
}

it('authorizes every photo read and upload in the DO, with anonymous/non-member reads 404 and item-owner-only writes', async () => {
  const { caller, cacheOwner, stub, item, path } = await created()
  expect((await worker.fetch(appRequest(path), env)).status).toBe(404)
  await failure(stub.photoKey(caller.id, item.id), 'not_found')
  for (const user of [cacheOwner, 'outsider']) await failure(stub.photoUploadKey(user, item.id), 'not_found')
  await worker.fetch(upload(path, caller.cookie), env)
  for (const status of ['pending', 'removed']) {
    await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('UPDATE members SET status = ? WHERE user_id = ?', status, caller.id) })
    expect((await worker.fetch(appRequest(path, { cookie: caller.cookie }), env)).status).toBe(404)
    expect((await worker.fetch(upload(path, caller.cookie), env)).status).toBe(404)
    await failure(stub.photoKey(caller.id, item.id), 'not_found')
  }
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('DELETE FROM members WHERE user_id = ?', 'outsider') })
  await failure(stub.photoKey('outsider', item.id), 'not_found')
  expect(await stub.photoKey(cacheOwner, item.id)).toContain(item.id)
})

it('uploads, replaces and streams private same-origin images without disclosing R2 keys or accepting conditional cache bypass', async () => {
  const { caller, id, stub, item, path } = await created()
  const first = await worker.fetch(upload(path, caller.cookie), env)
  expect(first.status).toBe(200)
  const info = await first.json() as { photo_version: string }
  expect(info.photo_version).toMatch(/^[0-9a-f-]{36}$/)
  expect(JSON.stringify(info)).not.toContain('photo_path')
  const oldKey = await stub.photoKey(caller.id, item.id)
  expect(oldKey).toBe(`${id}/${item.id}/${info.photo_version}`)
  const read = await worker.fetch(new Request(base + path + '?v=untrusted', { headers: { Cookie: caller.cookie, 'If-None-Match': '*' } }), env)
  expect(read.status).toBe(200)
  expect(read.headers.get('Content-Type')).toBe('image/png')
  expect(read.headers.get('Cache-Control')).toBe('private, no-store')
  expect(read.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(new Uint8Array(await read.arrayBuffer())).toEqual(png)
  expect((await worker.fetch(upload(path, caller.cookie, jpeg, 'image/jpeg'), env)).status).toBe(200)
  const current = await stub.photoKey(caller.id, item.id)
  expect(current).not.toBe(oldKey)
  expect(await env.BUCKET.head(oldKey)).not.toBeNull()
  expect((await cleanup(stub)).map(row => JSON.parse(row.payload).key)).toEqual([oldKey])
  await stub.flushSync()
  expect(await env.BUCKET.head(oldKey)).toBeNull()
  expect(await env.BUCKET.head(current)).not.toBeNull()
  expect((await stub.listItems(caller.id))[0].photo_version).toBe(current.split('/').at(-1))
  await env.BUCKET.delete(current)
  expect((await worker.fetch(appRequest(path, { cookie: caller.cookie }), env)).status).toBe(404)
})

it('validates JPEG/PNG/WebP signatures and rejects SVG, MIME mismatch, empty data and unsupported types before writing R2', async () => {
  const { caller, path } = await created()
  for (const [bytes, type] of [[jpeg, 'image/jpeg'], [png, 'image/png'], [webp, 'image/webp']] as const) {
    expect((await worker.fetch(upload(path, caller.cookie, bytes, type), env)).status).toBe(200)
  }
  const before = (await env.BUCKET.list()).objects.length
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
  for (const [bytes, type] of [[svg, 'image/svg+xml'], [svg, 'image/jpeg'], [png, 'image/jpeg'], [new Uint8Array(), 'image/png'], [png, 'application/octet-stream'], [jpeg, 'text/html']] as const) {
    const response = await worker.fetch(upload(path, caller.cookie, bytes, type), env)
    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({ error: 'invalid_photo_type' })
  }
  expect((await env.BUCKET.list()).objects).toHaveLength(before)
})

it('caps actual chunked upload bytes even with a lying Content-Length and cancels before reading the remaining stream', async () => {
  const { caller, path } = await created()
  let pulls = 0, cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024 * 1024)) },
    cancel() { cancelled = true },
  }, { highWaterMark: 0 })
  const response = await worker.fetch(upload(path, caller.cookie, stream, 'image/png', { 'Content-Length': '1' }), env)
  expect(response.status).toBe(413)
  expect(cancelled).toBe(true)
  expect(pulls).toBe(6)
  expect((await env.BUCKET.list()).objects).toEqual([])
  expect((await worker.fetch(upload(path, caller.cookie, png, 'image/png', { 'Content-Length': String(MAX_PHOTO_BYTES + 1) }), env)).status).toBe(413)
  const boundary = new Uint8Array(MAX_PHOTO_BYTES)
  boundary.set(png)
  expect((await worker.fetch(upload(path, caller.cookie, boundary), env)).status).toBe(200)
})

for (const race of ['removed', 'ownership_lost', 'item_deleted']) {
  it(`re-checks after real R2 put when ${race}, recording durable orphan cleanup without attaching`, async () => {
    const { caller, cacheOwner, stub, item, path } = await created()
    const put = env.BUCKET.put.bind(env.BUCKET)
    vi.spyOn(env.BUCKET, 'put').mockImplementation(async (key, body, options) => {
      const result = await put(key, body, options)
      await runInDurableObject(stub, (_instance, state) => {
        if (race === 'removed') state.storage.sql.exec("UPDATE members SET status = 'removed' WHERE user_id = ?", caller.id)
        if (race === 'ownership_lost') state.storage.sql.exec('UPDATE items SET owner_id = ? WHERE id = ?', cacheOwner, item.id)
        if (race === 'item_deleted') state.storage.sql.exec('DELETE FROM items WHERE id = ?', item.id)
      })
      return result
    })
    expect((await worker.fetch(upload(path, caller.cookie), env)).status).toBe(404)
    const intents = await cleanup(stub)
    expect(intents).toHaveLength(1)
    const key = JSON.parse(intents[0].payload).key as string
    expect(await env.BUCKET.head(key)).not.toBeNull()
    await failure(stub.photoKey(cacheOwner, item.id), 'not_found')
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await env.BUCKET.head(key)).toBeNull()
    expect(await cleanup(stub)).toEqual([])
  })
}

it('retains cleanup through R2 failures and a crash after delete, then replays idempotently without deleting the replacement', async () => {
  const { caller, id, stub, item, path } = await created()
  await worker.fetch(upload(path, caller.cookie), env)
  const oldKey = await stub.photoKey(caller.id, item.id)
  await worker.fetch(upload(path, caller.cookie, jpeg, 'image/jpeg'), env)
  const currentKey = await stub.photoKey(caller.id, item.id)
  const intents = await cleanup(stub)
  const deletion = vi.spyOn(env.BUCKET, 'delete').mockRejectedValue(new Error('injected R2 failure'))
  for (let attempt = 0; attempt < 7; attempt++) expect(await runDurableObjectAlarm(stub)).toBe(true)
  expect(await cleanup(stub)).toEqual(intents)
  await runInDurableObject(stub, async (_instance, state) => { expect(await state.storage.getAlarm()).not.toBeNull() })
  deletion.mockRestore()
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON pending_sync WHEN OLD.kind = 'r2_delete' BEGIN SELECT RAISE(ABORT, 'injected cleanup crash'); END") })
  await failure(stub.flushSync(), 'injected cleanup crash')
  expect(await env.BUCKET.head(oldKey)).toBeNull()
  expect(await cleanup(stub)).toEqual(intents)
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('DROP TRIGGER fail_cleanup') })
  await abortAllDurableObjects()
  const restarted = env.CACHES.get(env.CACHES.idFromName(id))
  await restarted.flushSync()
  expect(await cleanup(restarted)).toEqual([])
  expect(await env.BUCKET.head(currentKey)).not.toBeNull()
})

it('rolls attachment and replacement cleanup back together if intent recording fails', async () => {
  const { caller, stub, item, path } = await created()
  await worker.fetch(upload(path, caller.cookie), env)
  const oldKey = await stub.photoKey(caller.id, item.id)
  const key = await stub.photoUploadKey(caller.id, item.id)
  await env.BUCKET.put(key, png)
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("CREATE TRIGGER fail_intent BEFORE INSERT ON pending_sync WHEN NEW.kind = 'r2_delete' BEGIN SELECT RAISE(ABORT, 'injected intent failure'); END") })
  await failure(stub.finishPhotoUpload(caller.id, item.id, key, true), 'injected intent failure')
  expect(await stub.photoKey(caller.id, item.id)).toBe(oldKey)
  expect(await cleanup(stub)).toEqual([])
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('DROP TRIGGER fail_intent') })
  expect(await stub.finishPhotoUpload(caller.id, item.id, key, false)).toBe(false)
  await stub.flushSync()
  expect(await env.BUCKET.head(key)).toBeNull()
  expect(await env.BUCKET.head(oldKey)).not.toBeNull()
})

it('isolates concurrent replacements by immutable keys and preserves an attachment after an uncertain response', async () => {
  const { caller, stub, item } = await created()
  const [first, second] = await Promise.all([stub.photoUploadKey(caller.id, item.id), stub.photoUploadKey(caller.id, item.id)])
  expect(first).not.toBe(second)
  await Promise.all([env.BUCKET.put(first, png), env.BUCKET.put(second, jpeg)])
  expect(await stub.finishPhotoUpload(caller.id, item.id, second, true)).toBe(true)
  expect(await stub.finishPhotoUpload(caller.id, item.id, first, true)).toBe(true)
  expect(await stub.finishPhotoUpload(caller.id, item.id, first, false)).toBe(false)
  await stub.flushSync()
  expect(await env.BUCKET.head(second)).toBeNull()
  expect(await env.BUCKET.head(first)).not.toBeNull()
  expect(await stub.photoKey(caller.id, item.id)).toBe(first)
})

it('records cleanup when R2 put writes an object but its response fails, without replacing the current photo', async () => {
  const { caller, stub, item, path } = await created()
  await worker.fetch(upload(path, caller.cookie), env)
  const current = await stub.photoKey(caller.id, item.id)
  const put = env.BUCKET.put.bind(env.BUCKET)
  vi.spyOn(env.BUCKET, 'put').mockImplementation(async (key, body, options) => {
    await put(key, body, options)
    throw new Error('injected put response failure')
  })
  expect((await worker.fetch(upload(path, caller.cookie, jpeg, 'image/jpeg'), env)).status).toBe(500)
  expect(await stub.photoKey(caller.id, item.id)).toBe(current)
  const intents = await cleanup(stub)
  expect(intents).toHaveLength(1)
  const orphan = JSON.parse(intents[0].payload).key as string
  expect(await env.BUCKET.head(orphan)).not.toBeNull()
  await stub.flushSync()
  expect(await env.BUCKET.head(orphan)).toBeNull()
  expect(await env.BUCKET.head(current)).not.toBeNull()
})

it('protects photo mutations with Origin and profile gates and rejects wrong-cache item IDs', async () => {
  const { caller, stub, item, path } = await created()
  for (const origin of ['', 'null', 'https://foreign.test']) {
    const request = upload(path, caller.cookie)
    if (origin) request.headers.set('Origin', origin)
    else request.headers.delete('Origin')
    expect((await worker.fetch(request, env)).status).toBe(403)
  }
  await env.DB.prepare('UPDATE user SET display_name = NULL WHERE id = ?').bind(caller.id).run()
  expect((await worker.fetch(upload(path, caller.cookie), env)).status).toBe(409)
  await env.DB.prepare('UPDATE user SET display_name = ? WHERE id = ?').bind('Neighbor', caller.id).run()
  const otherId = crypto.randomUUID(), other = env.CACHES.get(env.CACHES.idFromName(otherId))
  await other.create(otherId, caller.id, 'Other', false)
  expect((await worker.fetch(upload(`/api/caches/${otherId}/items/${item.id}/photo`, caller.cookie), env)).status).toBe(404)
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("UPDATE items SET owner_id = (SELECT user_id FROM members WHERE role = 'owner') WHERE id = ?", item.id) })
  expect((await worker.fetch(upload(path, caller.cookie), env)).status).toBe(404)
  expect((await env.BUCKET.list()).objects).toEqual([])
})
