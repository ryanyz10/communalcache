import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, runInDurableObject, type D1Migration } from 'cloudflare:test'
import worker from '../src/index'
import { requireWriteLimit, writeLimits, type WriteRoute } from '../src/rate-limit'
import { HttpError } from '../src/http'
import { cacheJoinRequests, createCache, joinCache } from '../src/db'
import { appRequest, login } from './helpers'

async function profile(email = 'owner@example.test') {
  const caller = await login(email)
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: caller.cookie, body: { display_name: 'Neighbor' } }), env)
  return caller
}
async function user() {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?, ?, ?, 1, ?, ?, ?)')
    .bind(id, '', `${id}@example.test`, new Date().toISOString(), new Date().toISOString(), 'Neighbor').run()
  return id
}

it('upgrades the previous D1 schema additively without dropping users or the OTP uniqueness workaround', async () => {
  const id = await user()
  const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS
  const migration = migrations.find(row => row.name.includes('write_limits'))!
  await env.DB.exec('DROP TABLE write_limits')
  await env.DB.prepare('DELETE FROM d1_migrations WHERE name=?').bind(migration.name).run()
  await applyD1Migrations(env.DB, [migration])
  expect(await env.DB.prepare('SELECT id FROM user WHERE id=?').bind(id).first('id')).toBe(id)
  expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name='verification_sign_in_otp_identifier_unique'").first('name')).toBe('verification_sign_in_otp_identifier_unique')
  await requireWriteLimit(env.DB, id, 'join', 600_000)
  await env.DB.prepare('DELETE FROM user WHERE id=?').bind(id).run()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM write_limits').first('n')).toBe(0)
})

it('atomically admits the exact fixed-window budget across concurrent calls and persists rejected counters', async () => {
  const id = await user()
  const calls = await Promise.allSettled(Array.from({ length: 40 }, () => requireWriteLimit(env.DB, id, 'join', 610_000)))
  expect(calls.filter(row => row.status === 'fulfilled')).toHaveLength(10)
  const rejected = calls.filter(row => row.status === 'rejected') as PromiseRejectedResult[]
  expect(rejected.every(row => row.reason instanceof HttpError && row.reason.status === 429 && row.reason.retryAfter === 50)).toBe(true)
  expect(await env.DB.prepare('SELECT count FROM write_limits WHERE user_id=? AND route=?').bind(id, 'join').first('count')).toBe(10)
  await expect(requireWriteLimit(env.DB, id, 'join', 659_999)).rejects.toMatchObject({ status: 429, retryAfter: 1 })
  await requireWriteLimit(env.DB, id, 'join', 660_000)
  // An older invocation reaching D1 late cannot reset the newer window.
  await expect(requireWriteLimit(env.DB, id, 'join', 610_000)).rejects.toMatchObject({ status: 429 })
  expect(await env.DB.prepare('SELECT window_start,count FROM write_limits WHERE user_id=?').bind(id).first()).toEqual({ window_start: 660_000, count: 1 })
})

it('isolates users and route families and reuses only four counter rows rather than accumulating windows', async () => {
  const first = await user(), second = await user()
  for (const route of Object.keys(writeLimits) as WriteRoute[]) {
    for (let count = 0; count < writeLimits[route]; count++) await requireWriteLimit(env.DB, first, route, 600_000)
    await expect(requireWriteLimit(env.DB, first, route, 600_000)).rejects.toMatchObject({ status: 429 })
    await requireWriteLimit(env.DB, second, route, 600_000)
    for (let minute = 11; minute < 15; minute++) await requireWriteLimit(env.DB, first, route, minute * 60_000)
  }
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM write_limits WHERE user_id=?').bind(first).first('n')).toBe(4)
})

it('limits Worker join writes across arbitrary cache IDs with Retry-After and no mutation', async () => {
  const owner = await profile(), member = await profile('member@example.test')
  const info = await createCache(env.DB, owner.id, 'Tools', true), id = info.id
  await joinCache(env.DB, id, member.id, info.invite_token.split('.')[1])
  const now = Date.now(), windowStart = Math.floor(now / 60_000) * 60_000
  // Exhaust through the real atomic D1 statement without racing wall-clock minutes in a long loop.
  for (const route of Object.keys(writeLimits) as WriteRoute[]) {
    await env.DB.prepare('INSERT INTO write_limits(user_id,route,window_start,count) VALUES (?,?,?,?)').bind(member.id, route, windowStart, writeLimits[route]).run()
  }
  const routes = [
    `/api/caches/${id}/join`, `/api/caches/${crypto.randomUUID()}/join`,
    `/api/caches/${id}/join-requests/${owner.id}/approve`, `/api/caches/${id}/join-requests/${owner.id}/reject`,
  ]
  for (const path of routes) {
    const response = await worker.fetch(appRequest(path, { method: 'POST', cookie: member.cookie, body: { secret: info.invite_token.split('.')[1] } }), env)
    expect(response.status).toBe(429)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
    expect(Number(response.headers.get('Retry-After'))).toBeLessThanOrEqual(60)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'rate_limited' })
  }
  expect(await cacheJoinRequests(env.DB, id, owner.id)).toHaveLength(1)
  expect((await worker.fetch(appRequest(`/api/caches/${id}`, { cookie: owner.cookie }), env)).status).toBe(200)
  expect((await worker.fetch(appRequest(`/api/caches/${id}/join-requests/${member.id}/approve`, { method: 'POST', cookie: owner.cookie, body: {} }), env)).status).toBe(200)
})

it('counts attempted writes including invalid invites but never unverified, anonymous, CSRF or profile failures', async () => {
  const caller = await login()
  const path = `/api/caches/${crypto.randomUUID()}/join`
  expect((await worker.fetch(appRequest(path, { method: 'POST', body: {} }), env)).status).toBe(401)
  expect((await worker.fetch(appRequest(path, { method: 'POST', cookie: caller.cookie, body: {} }), env)).status).toBe(409)
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: caller.cookie, body: { display_name: 'Neighbor' } }), env)
  expect((await worker.fetch(appRequest(path, { method: 'POST', cookie: caller.cookie, origin: 'https://foreign.test', body: {} }), env)).status).toBe(403)
  await env.DB.prepare('UPDATE user SET emailVerified=0 WHERE id=?').bind(caller.id).run()
  expect((await worker.fetch(appRequest(path, { method: 'POST', cookie: caller.cookie, body: {} }), env)).status).toBe(401)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM write_limits').first('n')).toBe(0)
  await env.DB.prepare('UPDATE user SET emailVerified=1 WHERE id=?').bind(caller.id).run()
  expect((await worker.fetch(appRequest(path, { method: 'POST', cookie: caller.cookie, body: { secret: 'bad' } }), env)).status).toBe(404)
  expect(await env.DB.prepare('SELECT count FROM write_limits WHERE user_id=?').bind(caller.id).first('count')).toBe(1)
})

it('reports sync retry/backlog age without cache names, payloads or invite secrets', async () => {
  const owner = await user(), id = crypto.randomUUID(), stub = env.CACHES.get(env.CACHES.idFromName(id))
  const info = await stub.create(id, owner, 'Private cache name', false)
  await env.DB.exec("CREATE TRIGGER fail_registry BEFORE INSERT ON caches BEGIN SELECT RAISE(ABORT, 'private injected detail'); END")
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    let failure: unknown
    try { await stub.flushSync() } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    const message = log.mock.calls.map(row => String(row[0])).find(row => row.includes('cache_sync_failed'))!
    expect(JSON.parse(message)).toMatchObject({ event: 'cache_sync_failed', failures: 1, retry_at: expect.any(Number), oldest_pending_age_ms: expect.any(Number) })
    expect(message).not.toContain('Private cache name')
    expect(message).not.toContain('private injected detail')
    expect(message).not.toContain(info.invite_token.split('.')[1])
  } finally { await env.DB.exec('DROP TRIGGER fail_registry'); log.mockRestore() }
  await stub.flushSync()
  await runInDurableObject(stub, (_instance, state) => { expect(state.storage.sql.exec('SELECT 1 FROM pending_sync').toArray()).toEqual([]) })
})

it('canonicalizes mixed-case D1 cache/applicant/item IDs and keeps requests/destruction gated', async () => {
  const owner = await profile(), member = await profile('member@example.test')
  const info = await createCache(env.DB, owner.id, 'Pantry', true), id = info.id
  const base = `/api/caches/${id.toUpperCase()}`
  const call = (path: string, method = 'GET', body?: unknown, cookie = owner.cookie) => worker.fetch(appRequest(path, { method, cookie, body }), env)
  expect((await call(base)).status).toBe(200)
  expect((await call(base, 'PATCH', { name: 'Tools' })).status).toBe(200)
  expect((await call(base + '/join', 'POST', { secret: info.invite_token.split('.')[1] }, member.cookie)).status).toBe(200)
  expect((await call(base + '/join-requests')).status).toBe(200)
  expect((await call(base + `/join-requests/${member.id.toUpperCase()}/approve`, 'POST', {})).status).toBe(200)
  const itemPath = base + `/items/${crypto.randomUUID().toUpperCase()}`
  expect((await call(base + '/items')).status).toBe(200)
  expect((await call(itemPath)).status).toBe(404)
  expect((await call(itemPath + '/photo')).status).toBe(404)
  expect((await call(base + `/requests/${crypto.randomUUID().toUpperCase()}/approve`, 'POST', {})).status).toBe(503)
  expect((await call(base + `/members/${member.id.toUpperCase()}`, 'DELETE')).status).toBe(503)
  expect((await call(base, 'GET', undefined, member.cookie)).status).toBe(200)
})
