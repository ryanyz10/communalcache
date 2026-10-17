import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, reset, type D1Migration } from 'cloudflare:test'
import worker from '../src/index'
import { createCache, createItem } from '../src/db'
import { requireWriteLimit, writeLimits } from '../src/rate-limit'
import { appRequest, base, login } from './helpers'

const hour = 3_600_000
const jpeg = new Uint8Array([255, 216, 255, 217])
async function fixture() {
  const owner = await login('photo-owner@example.test')
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: owner.cookie, body: { display_name: 'Owner' } }), env)
  const cache = await createCache(env.DB, owner.id, 'Tools', false)
  const item = await createItem(env.DB, owner.id, { title: 'Mixer', is_consumable: false }, cache.id)
  return { owner, item, paths: ['/api/me/photo', `/api/me/items/${item.id}/photo`, `/api/caches/${cache.id}/items/${item.id}/photo`] }
}
function upload(path: string, cookie: string) {
  return new Request(base + path, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'image/jpeg' }, body: jpeg })
}

it('upgrades the route CHECK without losing previous counters, constraints or cascade ownership', async () => {
  const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS
  const index = migrations.findIndex(row => row.name.includes('photo_upload_limit'))
  await reset(); await applyD1Migrations(env.DB, migrations.slice(0, index))
  const stamp = new Date().toISOString(), userId = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)')
    .bind(userId, '', 'upgrade@example.test', stamp, stamp).run()
  const routes = ['join', 'join_decision', 'request', 'request_decision']
  for (const route of routes) await env.DB.prepare('INSERT INTO write_limits VALUES (?,?,?,?)').bind(userId, route, 600_000, 3).run()
  const before = (await env.DB.prepare('SELECT * FROM write_limits ORDER BY route').all()).results
  await applyD1Migrations(env.DB, migrations.slice(index))
  expect((await env.DB.prepare('SELECT * FROM write_limits ORDER BY route').all()).results).toEqual(before)
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  await requireWriteLimit(env.DB, userId, 'photo_upload', 600_000)
  await expect(env.DB.prepare('INSERT INTO write_limits VALUES (?,?,?,1)').bind(userId, 'unknown', 0).run()).rejects.toThrow()
  await expect(env.DB.prepare('INSERT INTO write_limits VALUES (?,?,?,0)').bind(crypto.randomUUID(), 'photo_upload', 0).run()).rejects.toThrow()
  await env.DB.prepare('DELETE FROM user WHERE id=?').bind(userId).run()
  expect(await env.DB.prepare('SELECT COUNT(*) FROM write_limits').first('COUNT(*)')).toBe(0)
})

it('atomically admits twenty concurrent attempts across fresh calls and resets only at the next clock hour', async () => {
  const { owner } = await fixture(), now = 10 * hour + 12_000
  const calls = await Promise.allSettled(Array.from({ length: 40 }, () => requireWriteLimit(env.DB, owner.id, 'photo_upload', now)))
  expect(calls.filter(call => call.status === 'fulfilled')).toHaveLength(20)
  for (const call of calls) if (call.status === 'rejected') expect(call.reason).toMatchObject({ status: 429, code: 'rate_limited', limit: 'photo_upload', retryAfter: 3588 })
  expect(await env.DB.prepare("SELECT count FROM write_limits WHERE user_id=? AND route='photo_upload'").bind(owner.id).first('count')).toBe(20)
  await expect(requireWriteLimit(env.DB, owner.id, 'photo_upload', 11 * hour - 1)).rejects.toMatchObject({ retryAfter: 1 })
  await requireWriteLimit(env.DB, owner.id, 'photo_upload', 11 * hour)
  await expect(requireWriteLimit(env.DB, owner.id, 'photo_upload', now)).rejects.toMatchObject({ status: 429 })
  expect(await env.DB.prepare("SELECT window_start,count FROM write_limits WHERE user_id=? AND route='photo_upload'").bind(owner.id).first()).toEqual({ window_start: 11 * hour, count: 1 })
})

it('shares the HTTP budget across profile, private item and cache item photos before body reads or R2 puts', async () => {
  const f = await fixture(), start = Math.floor(Date.now() / hour) * hour
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(start + 10_000)
  try {
    const put = vi.spyOn(env.BUCKET, 'put')
    for (let index = 0; index < writeLimits.photo_upload; index++) {
      const response = await worker.fetch(upload(f.paths[index % f.paths.length], f.owner.cookie), env)
      expect(response.status).toBe(200)
    }
    const currentProfile = await env.DB.prepare('SELECT photo_path FROM user_photos WHERE user_id=?').bind(f.owner.id).first('photo_path')
    const currentItem = await env.DB.prepare('SELECT photo_path FROM items WHERE id=?').bind(f.item.id).first('photo_path')
    expect(currentProfile).toBeTruthy(); expect(currentItem).toBeTruthy()
    expect((await env.BUCKET.list()).objects).toHaveLength(20)
    for (const path of f.paths) {
      const request = upload(path, f.owner.cookie), read = vi.spyOn(request.body!, 'getReader')
      const response = await worker.fetch(request, env)
      expect(response.status).toBe(429)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('Retry-After')).toBe('3590')
      expect(await response.json()).toEqual({ error: 'rate_limited', limit: 'photo_upload' })
      expect(read).not.toHaveBeenCalled()
    }
    expect(put).toHaveBeenCalledTimes(20)
    expect((await env.BUCKET.list()).objects).toHaveLength(20)
    expect(await env.DB.prepare('SELECT photo_path FROM user_photos WHERE user_id=?').bind(f.owner.id).first('photo_path')).toBe(currentProfile)
    expect(await env.DB.prepare('SELECT photo_path FROM items WHERE id=?').bind(f.item.id).first('photo_path')).toBe(currentItem)
    expect((await worker.fetch(appRequest('/api/me/photo', { cookie: f.owner.cookie }), env)).status).toBe(200)
    expect((await worker.fetch(appRequest('/api/me/photo', { method: 'DELETE', cookie: f.owner.cookie }), env)).status).toBe(204)
    vi.setSystemTime(start + hour)
    expect((await worker.fetch(upload(f.paths[0], f.owner.cookie), env)).status).toBe(200)
    expect(put).toHaveBeenCalledTimes(21)
  } finally { vi.useRealTimers() }
})

it('keeps another user independent and normal replacements available below the shared allowance', async () => {
  const f = await fixture(), other = await login('other-photo@example.test')
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: other.cookie, body: { display_name: 'Other' } }), env)
  const start = Math.floor(Date.now() / hour) * hour
  await env.DB.prepare("INSERT INTO write_limits VALUES (?,'photo_upload',?,?)").bind(f.owner.id, start, 20).run()
  expect((await worker.fetch(upload(f.paths[0], f.owner.cookie), env)).status).toBe(429)
  for (let index = 0; index < 2; index++) expect((await worker.fetch(upload('/api/me/photo', other.cookie), env)).status).toBe(200)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user_photos').first('n')).toBe(1)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM r2_cleanup').first('n')).toBe(1)
  expect((await env.BUCKET.list()).objects).toHaveLength(2)
})

it('fails closed before reading the body or writing R2 if durable admission fails', async () => {
  const f = await fixture(), put = vi.spyOn(env.BUCKET, 'put')
  await env.DB.exec("CREATE TRIGGER fail_photo_admission BEFORE INSERT ON write_limits WHEN NEW.route='photo_upload' BEGIN SELECT RAISE(ABORT,'injected admission failure'); END")
  for (const path of f.paths) {
    const request = upload(path, f.owner.cookie), read = vi.spyOn(request.body!, 'getReader')
    const response = await worker.fetch(request, env)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal_error' })
    expect(read).not.toHaveBeenCalled()
  }
  expect(put).not.toHaveBeenCalled()
  expect((await env.BUCKET.list()).objects).toHaveLength(0)
})
