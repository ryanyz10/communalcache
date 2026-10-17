import { beforeAll, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { createCache, createItem, createRequest, joinCache } from '../src/db'
import { adminCachePlan, adminFlags, adminOverview, adminSetFlag, adminUserPlan } from '../src/db/admin'
import { appRequest, base, login } from './helpers'

const issuer = 'https://fixture-team.cloudflareaccess.com', audience = 'a'.repeat(64), kid = 'fixture-access-key'
let keys: CryptoKeyPair, publicKey: JsonWebKey
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const json = (value: unknown) => encode(new TextEncoder().encode(JSON.stringify(value)))
beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey) as JsonWebKey
})
async function jwt(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  const input = `${json({ alg: 'RS256', kid, ...header })}.${json({ iss: issuer, aud: [audience], exp: now + 600, nbf: now - 10, ...overrides })}`
  return input + '.' + encode(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(input))))
}
function jwksMock() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    expect(String(input)).toBe(issuer + '/cdn-cgi/access/certs')
    expect(init?.redirect).toBe('manual')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    return Response.json({ keys: [{ ...publicKey, kid, alg: 'RS256', use: 'sig' }] })
  }).mockClear()
}
async function fixture() {
  const admin = await login('admin-private@example.test')
  const bindings = { ...env, CF_ACCESS_TEAM_DOMAIN: issuer, CF_ACCESS_AUD: audience, ADMIN_USER_IDS: admin.id,
    ASSETS: { fetch: vi.fn(async () => new Response('<admin/>', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=3600' } })) } as unknown as Fetcher }
  const fetch = jwksMock(), assertion = await jwt()
  const actor = { userId: admin.id, sessionToken: admin.token }
  async function call(path: string, options: { method?: string; body?: unknown; token?: string | null; cookie?: string | null; origin?: string | null; host?: string } = {}, override = bindings) {
    const request = appRequest(path, { method: options.method, body: options.body, cookie: options.cookie === null ? undefined : options.cookie ?? admin.cookie, origin: options.origin })
    const headers = new Headers(request.headers)
    if (options.token !== null) headers.set('Cf-Access-Jwt-Assertion', options.token ?? assertion)
    const url = options.host ? new URL(path, options.host) : request.url
    return worker.fetch(new Request(url, { method: request.method, headers, body: request.body }), override)
  }
  return { admin, bindings, fetch, assertion, actor, call }
}
async function hidden(response: Response) {
  expect(response.status).toBe(404)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({ error: 'not_found' })
}

it('requires both verified Access and a current allowlisted app session on HTML/API and alternate hosts', async () => {
  const f = await fixture()
  for (const host of [base, 'https://unprotected.workers.dev']) {
    const response = await f.call('/api/admin/overview', { host })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const page = await f.call('/admin', { host })
    expect(await page.text()).toBe('<admin/>')
    expect(page.headers.get('Cache-Control')).toBe('no-store')
    await hidden(await f.call('/admin', { host, token: null }))
    await hidden(await f.call('/api/admin/users', { host, token: null }))
  }
  await hidden(await f.call('/api/admin/users', { cookie: null }))
  await hidden(await f.call('/api/admin/users', {}, { ...f.bindings, ADMIN_USER_IDS: crypto.randomUUID() }))
  expect((await f.call('/api/admin/users', {}, { ...f.bindings, ADMIN_USER_IDS: `${crypto.randomUUID()}, ${f.admin.id}` })).status).toBe(200)
  await env.DB.prepare('DELETE FROM session WHERE token=?').bind(f.admin.token).run()
  await hidden(await f.call('/api/admin/overview'))
})

it('fails closed on missing/invalid configuration before any key fetch', async () => {
  const f = await fixture()
  for (const overrides of [
    { CF_ACCESS_TEAM_DOMAIN: '' }, { CF_ACCESS_AUD: '' }, { ADMIN_USER_IDS: '' }, { ADMIN_USER_IDS: 'not-a-user-id' },
    { CF_ACCESS_TEAM_DOMAIN: 'https://evil.test' }, { CF_ACCESS_TEAM_DOMAIN: issuer + '/path' },
    { CF_ACCESS_TEAM_DOMAIN: 'http://fixture-team.cloudflareaccess.com' }, { CF_ACCESS_AUD: 'bad-audience' },
  ]) for (const path of ['/admin', '/api/admin/overview']) await hidden(await f.call(path, {}, { ...f.bindings, ...overrides }))
  expect(f.fetch).not.toHaveBeenCalled()
  await hidden(await worker.fetch(appRequest('/api/admin/overview', { cookie: f.admin.cookie }), env))
})

it('rejects missing/expired/future/wrong-authority/unsigned/tampered JWTs without trusting identity headers or cookies', async () => {
  const f = await fixture(), now = Math.floor(Date.now() / 1000)
  const wrongTokens = [null, '', 'bad.jwt', await jwt({ exp: now - 60 }), await jwt({ nbf: now + 60 }),
    await jwt({ exp: 'tomorrow' }), await jwt({ aud: ['b'.repeat(64)] }), await jwt({ iss: 'https://evil.test' }),
    await jwt({}, { alg: 'HS256' }), await jwt({}, { alg: 'none' }), await jwt({}, { kid: 'unknown-key' }), await jwt({}, { crit: ['b64'] })]
  const parts = f.assertion.split('.')
  wrongTokens.push(parts.slice(0, 2).join('.') + '.' + (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1))
  for (const token of wrongTokens) await hidden(await f.call('/api/admin/overview', { token }))
  const request = appRequest('/api/admin/overview', { cookie: `${f.admin.cookie}; CF_Authorization=${f.assertion}` })
  request.headers.set('Cf-Access-Authenticated-User-Email', 'admin-private@example.test')
  await hidden(await worker.fetch(request, f.bindings))
  const validStringAudience = await f.call('/api/admin/overview', { token: await jwt({ aud: audience, exp: now - 5, nbf: now + 5 }) })
  expect(validStringAudience.status).toBe(200)
})

it('pins JWKS to the configured team, refuses redirects/errors/bad keys and fails closed on transport failure', async () => {
  const f = await fixture()
  for (const response of [new Response(null, { status: 302, headers: { Location: 'https://evil.test/keys' } }), new Response(null, { status: 503 }), Response.json({ keys: [] }), Response.json({ keys: [{ kid, kty: 'EC' }] }), Response.json({ keys: [{ kid, kty: 'RSA', n: 'broken', e: 'AQAB' }] })]) {
    f.fetch.mockResolvedValueOnce(response)
    await hidden(await f.call('/api/admin/overview'))
  }
  f.fetch.mockRejectedValueOnce(new Error('private transport detail'))
  await hidden(await f.call('/api/admin/overview'))
  expect(f.fetch.mock.calls.every(([input]) => String(input) === issuer + '/cdn-cgi/access/certs')).toBe(true)
})

it('bounds the JWKS request timeout and returns only a private generic denial', async () => {
  const f = await fixture()
  f.fetch.mockImplementationOnce(async (_input, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
  }))
  const started = Date.now()
  await hidden(await f.call('/api/admin/overview'))
  expect(Date.now() - started).toBeGreaterThanOrEqual(4_900)
  expect(Date.now() - started).toBeLessThan(8_000)
})

it('returns names/IDs, live usage/quota counts and safe failed-outbox metadata without selecting private payloads', async () => {
  const f = await fixture(), member = crypto.randomUUID(), now = new Date().toISOString()
  await env.DB.prepare('UPDATE user SET display_name=? WHERE id=?').bind('Owner name', f.admin.id).run()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,display_name,createdAt,updatedAt) VALUES (?,?,?,1,?,?,?)').bind(member, '', 'member-private@example.test', 'Member name', now, now).run()
  const cache = await createCache(env.DB, f.admin.id, 'Tools', false)
  await joinCache(env.DB, cache.id, member, cache.invite_token.split('.')[1])
  const item = await createItem(env.DB, f.admin.id, { title: 'Private item title', is_consumable: false }, cache.id)
  await createRequest(env.DB, item.id, cache.id, member, null)
  await env.DB.prepare("INSERT INTO outbox(id,kind,dedupe_key,payload,created_at,failed_at,attempts) VALUES (?,'request_created',?,?,?, ?,6)")
    .bind(crypto.randomUUID(), crypto.randomUUID(), JSON.stringify({ recipient: 'outbox-private@example.test', contact: 'private-contact', message: 'private-message' }), Date.now() - 600_000, Date.now()).run()
  await env.DB.prepare("INSERT INTO outbox(id,kind,dedupe_key,payload,created_at) VALUES (?,'request_created',?,?,?)")
    .bind(crypto.randomUUID(), crypto.randomUUID(), '{}', Date.now() - 300_000).run()
  await env.DB.prepare("INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at,scope) VALUES (?,?,NULL,'exact',?,?,'profile')")
    .bind(crypto.randomUUID(), f.admin.id, `users/${f.admin.id}/${crypto.randomUUID()}`, Date.now() - 420_000).run()
  const responses: Record<string, any> = {}
  for (const path of ['overview', 'caches', 'users', 'failed-outbox']) {
    const response = await f.call('/api/admin/' + path)
    expect(response.status).toBe(200)
    const text = await response.text()
    for (const privateValue of ['admin-private@example.test', 'member-private@example.test', 'outbox-private@example.test', 'private-contact', 'private-message', 'Private item title', 'payload', 'photo_path']) expect(text).not.toContain(privateValue)
    responses[path] = JSON.parse(text)
  }
  expect(responses.overview).toMatchObject({ users: 2, caches: 1, items: 1, pending_requests: 1, outbox_pending: 2, outbox_failed: 1 })
  expect(responses.overview.outbox_oldest_age_ms).toBeGreaterThanOrEqual(300_000)
  expect(responses.overview.cleanup_pending).toBe(1)
  expect(responses.overview.cleanup_oldest_age_ms).toBeGreaterThanOrEqual(420_000)
  expect(responses.caches.rows[0]).toMatchObject({ id: cache.id, owner_id: f.admin.id, owner_name: 'Owner name', member_count: 2, member_limit: 30, item_count: 1 })
  expect(responses.users.rows.find((row: any) => row.id === f.admin.id)).toMatchObject({ owned_caches: 1, owned_cache_limit: 1, owned_items: 1, owned_item_limit: 100, new_caches_24h: 1 })
  expect(responses.users.rows.find((row: any) => row.id === member)).toMatchObject({ pending_outgoing: 1, pending_limit: 20, memberships: 1, membership_limit: 20 })
  expect(Object.keys(responses['failed-outbox'].rows[0]).sort()).toEqual(['attempts', 'created_at', 'error_class', 'failed_at', 'id', 'kind'])
  expect(responses['failed-outbox'].rows[0].error_class).toBeNull()
})

it('changes user/cache plans with a policy-guarded UPDATE, rejects invalid plans/origins and preserves existing over-cap data', async () => {
  const f = await fixture(), cache = await createCache(env.DB, f.admin.id, 'Tools', false)
  const item = await createItem(env.DB, f.admin.id, { title: 'Keep this', is_consumable: false }, cache.id)
  await env.DB.prepare("UPDATE plan_limits SET owned_items=0 WHERE plan='free'").run()
  for (const [kind, id] of [['caches', cache.id], ['users', f.admin.id]]) {
    for (const plan of ['plus', 'free']) {
      const response = await f.call(`/api/admin/${kind}/${id}/plan`, { method: 'PATCH', body: { plan, user_id: 'forged' } })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ id, plan })
      expect(await env.DB.prepare(`SELECT plan FROM ${kind === 'users' ? 'user' : 'caches'} WHERE id=?`).bind(id).first('plan')).toBe(plan)
    }
    for (const plan of ['enterprise', null, 1, 'PLUS']) expect((await f.call(`/api/admin/${kind}/${id}/plan`, { method: 'PATCH', body: { plan } })).status).toBe(400)
    for (const origin of [null, 'null', 'https://foreign.test']) {
      const response = await f.call(`/api/admin/${kind}/${id}/plan`, { method: 'PATCH', origin, body: { plan: 'plus' } })
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'invalid_origin' })
    }
  }
  expect(await env.DB.prepare('SELECT id FROM items WHERE id=?').bind(item.id).first('id')).toBe(item.id)
  await env.DB.prepare("DELETE FROM plan_limits WHERE plan='plus'").run()
  await hidden(await f.call(`/api/admin/users/${f.admin.id}/plan`, { method: 'PATCH', body: { plan: 'plus' } }))
  expect(await env.DB.prepare('SELECT plan FROM user WHERE id=?').bind(f.admin.id).first('plan')).toBe('free')
})

it('guards the plan write and operational read against a session revoked after authorization', async () => {
  const f = await fixture(), cache = await createCache(env.DB, f.admin.id, 'Tools', false)
  await env.DB.prepare('DELETE FROM session WHERE token=?').bind(f.admin.token).run()
  await expect(adminUserPlan(env.DB, f.actor, f.admin.id, 'plus')).rejects.toThrow('not_found')
  await expect(adminCachePlan(env.DB, f.actor, cache.id, 'plus')).rejects.toThrow('not_found')
  await expect(adminOverview(env.DB, f.actor)).rejects.toThrow('not_found')
  expect(await env.DB.prepare('SELECT plan FROM caches WHERE id=?').bind(cache.id).first('plan')).toBe('free')
})

it('protects feature-switch GET/PATCH with Access, the app allowlist and alternate-host checks', async () => {
  const f = await fixture()
  const original = await env.DB.prepare('SELECT * FROM feature_flags').first()
  for (const host of [base, 'https://unprotected.workers.dev']) for (const path of ['/api/admin/flags', '/api/admin/flags/google_sign_in']) {
    const options = path.endsWith('google_sign_in') ? { method: 'PATCH', body: { enabled: false }, host } : { host }
    await hidden(await f.call(path, { ...options, token: null }))
    await hidden(await f.call(path, { ...options, cookie: null }))
    await hidden(await f.call(path, options, { ...f.bindings, ADMIN_USER_IDS: crypto.randomUUID() }))
    await hidden(await worker.fetch(appRequest(path, { ...options, cookie: f.admin.cookie }), env))
  }
  expect(await env.DB.prepare('SELECT * FROM feature_flags').first()).toEqual(original)
  const allowed = await f.call('/api/admin/flags', { host: 'https://unprotected.workers.dev' })
  expect(allowed.status).toBe(200)
  expect(allowed.headers.get('Cache-Control')).toBe('no-store')
  const result = await allowed.json() as { flags: { key: string; enabled: boolean; updated_at: number }[] }
  expect(result.flags[0]).toMatchObject({ key: 'google_sign_in', enabled: true })
  expect(Object.keys(result.flags[0]).sort()).toEqual(['enabled', 'key', 'updated_at'])
  expect(JSON.stringify(result)).not.toMatch(/email|admin-private|updated_by/)
})

it('updates feature switches in one current-session-guarded write with actor metadata and strict Origin/body checks', async () => {
  const f = await fixture(), path = '/api/admin/flags/google_sign_in'
  const original = await env.DB.prepare('SELECT * FROM feature_flags').first()
  for (const origin of [null, 'null', 'https://foreign.test']) {
    const response = await f.call(path, { method: 'PATCH', origin, body: { enabled: false } })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'invalid_origin' })
  }
  for (const enabled of [null, 0, 1, 'true', undefined]) {
    const response = await f.call(path, { method: 'PATCH', body: { enabled } })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_enabled' })
  }
  await hidden(await f.call('/api/admin/flags/unknown', { method: 'PATCH', body: { enabled: false } }))
  expect(await env.DB.prepare('SELECT * FROM feature_flags').first()).toEqual(original)
  for (const enabled of [false, true]) {
    const response = await f.call(path, { method: 'PATCH', body: { enabled, updated_by: 'forged-actor', updated_at: 1 } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ key: 'google_sign_in', enabled })
    expect(await env.DB.prepare('SELECT enabled,updated_by FROM feature_flags').first()).toEqual({ enabled: enabled ? 1 : 0, updated_by: f.admin.id })
    const listed = await (await f.call('/api/admin/flags')).json() as { flags: { enabled: boolean; updated_at: number }[] }
    expect(listed.flags[0].enabled).toBe(enabled)
    expect(Number.isInteger(listed.flags[0].updated_at)).toBe(true)
    expect(listed.flags[0].updated_at).toBeGreaterThan(1_000_000_000_000)
  }
  expect((await f.call(path)).status).toBe(405)
  expect((await f.call('/api/admin/flags', { method: 'POST', body: {} })).status).toBe(405)
  await env.DB.prepare('DELETE FROM session WHERE token=?').bind(f.admin.token).run()
  await expect(adminSetFlag(env.DB, f.actor, 'google_sign_in', false)).rejects.toThrow('not_found')
  expect(await adminFlags(env.DB, f.actor)).toEqual([])
  expect(await env.DB.prepare('SELECT enabled FROM feature_flags').first('enabled')).toBe(1)
})

it('paginates all three lists without overlap, validates cursors and keeps unknown/method/suspend routes closed', async () => {
  const f = await fixture(), stamp = new Date().toISOString()
  const statements: D1PreparedStatement[] = []
  for (let index = 0; index < 27; index++) {
    const id = `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`
    statements.push(env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,display_name,createdAt,updatedAt) VALUES (?,?,?,1,?,?,?)').bind(id, '', `${index}@private.example.test`, `Name ${index}`, stamp, stamp))
    statements.push(env.DB.prepare('INSERT INTO caches(id,name,created_at,join_secret) VALUES (?,?,?,?)').bind(id, `Cache ${index}`, Date.now(), 'A'.repeat(43)))
    statements.push(env.DB.prepare("INSERT INTO outbox(id,kind,dedupe_key,payload,created_at,failed_at,attempts) VALUES (?,'join_requested',?,'{}',?,?,6)").bind(id, id, Date.now(), Date.now()))
  }
  await env.DB.batch(statements)
  for (const kind of ['users', 'caches', 'failed-outbox']) {
    const first = await (await f.call('/api/admin/' + kind)).json() as { rows: { id: string }[]; next_cursor: string }
    expect(first.rows).toHaveLength(25)
    const second = await (await f.call(`/api/admin/${kind}?after=${first.next_cursor}`)).json() as { rows: { id: string }[]; next_cursor: string | null }
    expect(second.rows.length).toBe(kind === 'users' ? 3 : 2)
    expect(second.next_cursor).toBeNull()
    expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(kind === 'users' ? 28 : 27)
    expect((await f.call(`/api/admin/${kind}?after=invalid`)).status).toBe(400)
    expect((await f.call(`/api/admin/${kind}`, { method: 'POST', body: {} })).status).toBe(405)
  }
  await hidden(await f.call('/api/admin/missing'))
  await hidden(await f.call(`/api/admin/users/${f.admin.id}/suspend`, { method: 'PATCH', body: { suspended: true } }))
  expect((await f.call(`/api/admin/users/${f.admin.id}/plan`)).status).toBe(405)
})
