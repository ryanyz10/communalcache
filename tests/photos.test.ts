import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { abortAllDurableObjects, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test'
import worker from '../src/index'
import { MAX_PHOTO_BYTES, readPhoto } from '../src/photos'
import { appRequest, base, login } from './helpers'

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/f9sAAAAASUVORK5CYII='), char => char.charCodeAt(0))
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 2, 255, 217])
const webp = new Uint8Array([82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 0, 0, 0, 0])

async function created() {
  const owner = crypto.randomUUID(), caller = crypto.randomUUID(), id = crypto.randomUUID(), now = new Date().toISOString()
  for (const user of [owner, caller]) await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)').bind(user,'Neighbor',`${user}@example.test`,now,now).run()
  const stub = env.CACHES.get(env.CACHES.idFromName(id))
  const info = await stub.create(id, owner, 'Tools', false)
  await stub.join(caller, info.invite_token.split('.')[1])
  const item = await stub.createItem(caller, { title: 'Mixer', is_consumable: false })
  await stub.flushSync()
  return { id, owner, caller, stub, item }
}
function upload(bytes: BodyInit = png, type = 'image/png', headers: Record<string, string> = {}) {
  return new Request(base + '/photo-fixture', { method: 'POST', headers: { 'Content-Type': type, ...headers }, body: bytes })
}
async function failure(call: PromiseLike<unknown>, message: string) {
  let error: unknown
  try { await call } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain(message)
}
async function cleanup(stub: DurableObjectStub<import('../src/cache').Cache>) {
  return runInDurableObject(stub, (_instance, state) => state.storage.sql.exec<{ id: string; payload: string }>("SELECT id, payload FROM pending_sync WHERE kind='r2_delete' ORDER BY sequence").toArray())
}

it('retains legacy direct-DO photo authorization while its Worker API is gated', async () => {
  const { caller, owner, stub, item } = await created()
  await failure(stub.photoKey(caller, item.id), 'not_found')
  for (const user of [owner, 'outsider']) await failure(stub.photoUploadKey(user, item.id), 'not_found')
  const key = await stub.photoUploadKey(caller, item.id)
  await env.BUCKET.put(key, png)
  expect(await stub.finishPhotoUpload(caller, item.id, key, true)).toBe(true)
  for (const status of ['pending', 'removed']) {
    await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('UPDATE members SET status=? WHERE user_id=?', status, caller) })
    await failure(stub.photoKey(caller, item.id), 'not_found')
    await failure(stub.photoUploadKey(caller, item.id), 'not_found')
  }
  expect(await stub.photoKey(owner, item.id)).toBe(key)
})

it('retains immutable legacy photo replacement and public item DTOs without exposing keys', async () => {
  const { id, caller, stub, item } = await created()
  const first = await stub.photoUploadKey(caller, item.id)
  await env.BUCKET.put(first, png)
  await stub.finishPhotoUpload(caller, item.id, first, true)
  const dto = await stub.itemDetail(caller, item.id)
  expect(dto.photo_version).toBe(first.split('/').at(-1))
  expect(first).toBe(`${id}/${item.id}/${dto.photo_version}`)
  expect(JSON.stringify(dto)).not.toContain('photo_path')
  const second = await stub.photoUploadKey(caller, item.id)
  await env.BUCKET.put(second, jpeg)
  await stub.finishPhotoUpload(caller, item.id, second, true)
  expect((await cleanup(stub)).map(row => JSON.parse(row.payload).key)).toEqual([first])
  await stub.flushSync()
  expect(await env.BUCKET.head(first)).toBeNull()
  expect(await env.BUCKET.head(second)).not.toBeNull()
})

it('validates JPEG/PNG/WebP signatures and rejects SVG/MIME mismatch before any R2 call', async () => {
  for (const [bytes, type] of [[jpeg, 'image/jpeg'], [png, 'image/png'], [webp, 'image/webp']] as const) {
    expect(await readPhoto(upload(bytes, type))).toEqual({ bytes, contentType: type })
  }
  const svg = '<svg><script>alert(1)</script></svg>'
  for (const [bytes, type] of [[svg, 'image/svg+xml'], [svg, 'image/jpeg'], [png, 'image/jpeg'], [new Uint8Array(), 'image/png'], [png, 'application/octet-stream'], [jpeg, 'text/html']] as const) {
    await expect(readPhoto(upload(bytes, type))).rejects.toMatchObject({ status: 415 })
  }
  expect((await env.BUCKET.list()).objects).toEqual([])
})

it('caps actual chunked bytes despite lying Content-Length and cancels before reading the rest', async () => {
  let pulls = 0, cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024 * 1024)) },
    cancel() { cancelled = true },
  }, { highWaterMark: 0 })
  await expect(readPhoto(upload(stream, 'image/png', { 'Content-Length': '1' }))).rejects.toMatchObject({ status: 413 })
  expect(cancelled).toBe(true)
  expect(pulls).toBe(6)
  await expect(readPhoto(upload(png, 'image/png', { 'Content-Length': String(MAX_PHOTO_BYTES + 1) }))).rejects.toMatchObject({ status: 413 })
  const boundary = new Uint8Array(MAX_PHOTO_BYTES)
  boundary.set(png)
  expect((await readPhoto(upload(boundary))).bytes).toHaveLength(MAX_PHOTO_BYTES)
})

for (const race of ['removed', 'ownership_lost', 'item_deleted']) {
  it(`retains legacy direct-DO finalization rejection and durable cleanup after ${race}`, async () => {
    const { caller, owner, stub, item } = await created()
    const key = await stub.photoUploadKey(caller, item.id)
    await env.BUCKET.put(key, png)
    await runInDurableObject(stub, (_instance, state) => {
      if (race === 'removed') state.storage.sql.exec("UPDATE members SET status='removed' WHERE user_id=?", caller)
      if (race === 'ownership_lost') state.storage.sql.exec('UPDATE items SET owner_id=? WHERE id=?', owner, item.id)
      if (race === 'item_deleted') state.storage.sql.exec('DELETE FROM items WHERE id=?', item.id)
    })
    expect(await stub.finishPhotoUpload(caller, item.id, key, true)).toBe(false)
    expect((await cleanup(stub)).map(row => JSON.parse(row.payload).key)).toEqual([key])
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await env.BUCKET.head(key)).toBeNull()
  })
}

it('retains cleanup through repeated R2 failures and a crash after external delete', async () => {
  const { id, caller, stub, item } = await created()
  const first = await stub.photoUploadKey(caller, item.id), second = await stub.photoUploadKey(caller, item.id)
  await env.BUCKET.put(first, png)
  await stub.finishPhotoUpload(caller, item.id, first, true)
  await env.BUCKET.put(second, jpeg)
  await stub.finishPhotoUpload(caller, item.id, second, true)
  const intents = await cleanup(stub)
  const deletion = vi.spyOn(env.BUCKET, 'delete').mockRejectedValue(new Error('injected R2 failure'))
  for (let attempt = 0; attempt < 7; attempt++) expect(await runDurableObjectAlarm(stub)).toBe(true)
  expect(await cleanup(stub)).toEqual(intents)
  deletion.mockRestore()
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON pending_sync WHEN OLD.kind='r2_delete' BEGIN SELECT RAISE(ABORT,'injected cleanup crash'); END") })
  await failure(stub.flushSync(), 'injected cleanup crash')
  expect(await env.BUCKET.head(first)).toBeNull()
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('DROP TRIGGER fail_cleanup') })
  await abortAllDurableObjects()
  const restarted = env.CACHES.get(env.CACHES.idFromName(id))
  await restarted.flushSync()
  expect(await cleanup(restarted)).toEqual([])
  expect(await env.BUCKET.head(second)).not.toBeNull()
})

it('rolls legacy replacement and cleanup back together if intent recording fails', async () => {
  const { caller, stub, item } = await created()
  const first = await stub.photoUploadKey(caller, item.id), second = await stub.photoUploadKey(caller, item.id)
  await env.BUCKET.put(first, png)
  await stub.finishPhotoUpload(caller, item.id, first, true)
  await env.BUCKET.put(second, jpeg)
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("CREATE TRIGGER fail_intent BEFORE INSERT ON pending_sync WHEN NEW.kind='r2_delete' BEGIN SELECT RAISE(ABORT,'injected intent failure'); END") })
  await failure(stub.finishPhotoUpload(caller, item.id, second, true), 'injected intent failure')
  expect(await stub.photoKey(caller, item.id)).toBe(first)
  expect(await cleanup(stub)).toEqual([])
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('DROP TRIGGER fail_intent') })
  expect(await stub.finishPhotoUpload(caller, item.id, second, false)).toBe(false)
  await stub.flushSync()
  expect(await env.BUCKET.head(second)).toBeNull()
})

it('isolates concurrent immutable replacements and preserves the current key after an uncertain response', async () => {
  const { caller, stub, item } = await created()
  const [first, second] = await Promise.all([stub.photoUploadKey(caller, item.id), stub.photoUploadKey(caller, item.id)])
  expect(first).not.toBe(second)
  await Promise.all([env.BUCKET.put(first, png), env.BUCKET.put(second, jpeg)])
  expect(await stub.finishPhotoUpload(caller, item.id, second, true)).toBe(true)
  expect(await stub.finishPhotoUpload(caller, item.id, first, true)).toBe(true)
  expect(await stub.finishPhotoUpload(caller, item.id, first, false)).toBe(false)
  await stub.flushSync()
  expect(await env.BUCKET.head(second)).toBeNull()
  expect(await env.BUCKET.head(first)).not.toBeNull()
})

it('keeps Worker photo routes gated and Origin/profile guards intact', async () => {
  const caller = await login(), path = `/api/caches/${crypto.randomUUID()}/items/${crypto.randomUUID()}/photo`
  expect((await worker.fetch(appRequest(path), env)).status).toBe(404)
  expect((await worker.fetch(appRequest(path, { method: 'POST', cookie: caller.cookie, body: {} }), env)).status).toBe(409)
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: caller.cookie, body: { display_name: 'Neighbor' } }), env)
  for (const origin of [null, 'null', 'https://foreign.test']) expect((await worker.fetch(appRequest(path, { method: 'POST', cookie: caller.cookie, origin, body: {} }), env)).status).toBe(403)
  for (const method of ['GET', 'POST']) expect((await worker.fetch(appRequest(path, { method, cookie: caller.cookie }), env)).status).toBe(503)
  expect((await env.BUCKET.list()).objects).toEqual([])
})
