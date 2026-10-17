import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { workerResponseFixture } from './fixtures/worker-response-fixture'

const base = 'https://communalcache.com'
const now = Date.parse('2026-10-01T12:00:00.000Z')
const stamp = new Date(now).toISOString()
const owner = '11111111-1111-4111-8111-111111111111'
const member = '22222222-2222-4222-8222-222222222222'
const stranger = '33333333-3333-4333-8333-333333333333'
const removed = '44444444-4444-4444-8444-444444444444'
const unnamed = '55555555-5555-4555-8555-555555555555'
const applicant = '66666666-6666-4666-8666-666666666666'
const unverified = '77777777-7777-4777-8777-777777777777'
const cache = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const item = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const reusable = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc'
const pendingRequest = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const approvedRequest = 'cccccccc-cccc-4ccc-8ccc-cccccccccccd'
const reusableRequest = 'cccccccc-cccc-4ccc-8ccc-ccccccccccce'
const photo = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const secret = 'A'.repeat(43)
const jpeg = new Uint8Array([255, 216, 255, 217])
const actors = [owner, member, stranger, removed, unnamed, applicant, unverified]
const writes = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
const pointHex = '046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const subscription = {
  endpoint: 'https://fcm.googleapis.com/push/parity',
  keys: { p256dh: encode(Uint8Array.from(pointHex.match(/../g)!, byte => parseInt(byte, 16))), auth: encode(new Uint8Array(16).fill(7)) },
}

type Route = { name: string; path: string; methods: string[]; body?: unknown; binary?: boolean }
const cachePath = `/api/caches/${cache}`
const itemPath = `${cachePath}/items/${item}`
const privatePath = `/api/me/items/${item}`
const requestPath = `/api/me/requests/${pendingRequest}`
const routes: Route[] = [
  { name: 'health', path: '/api/healthz', methods: ['GET', 'HEAD'] },
  { name: 'config', path: '/api/config', methods: ['GET', 'HEAD'] },
  { name: 'profile', path: '/api/me', methods: ['GET', 'PATCH'], body: { display_name: 'Updated', cat_coat: 'ginger' } },
  { name: 'summary', path: '/api/me/summary', methods: ['GET'] },
  { name: 'caches', path: '/api/caches', methods: ['GET', 'POST'], body: { name: 'Created', requires_approval: true } },
  { name: 'requests', path: '/api/requests', methods: ['GET'] },
  { name: 'push', path: '/api/push/subscribe', methods: ['POST', 'DELETE'], body: subscription },
  { name: 'contact', path: '/api/me/contact', methods: ['GET', 'PUT', 'DELETE'], body: { kind: 'email', value: 'chosen@example.test' } },
  { name: 'contact-preview', path: '/api/me/contact/preview', methods: ['POST'], body: { kind: 'whatsapp', value: '+15550141111' } },
  { name: 'own-photo', path: '/api/me/photo', methods: ['GET', 'POST', 'DELETE'], binary: true },
  { name: 'user-photo', path: `/api/users/${owner}/photo`, methods: ['GET'] },
  { name: 'library', path: '/api/me/items', methods: ['GET', 'POST'], body: { title: 'Created', is_consumable: false, quantity: null } },
  { name: 'library-item', path: privatePath, methods: ['GET', 'PATCH', 'DELETE'], body: { title: 'Updated', quantity: 8, available: false, unavailable_note: 'With a neighbor' } },
  { name: 'library-photo', path: `${privatePath}/photo`, methods: ['GET', 'POST'], binary: true },
  { name: 'attachment', path: `${privatePath}/attachments/${cache}`, methods: ['PUT', 'DELETE'], body: {} },
  { name: 'cache', path: cachePath, methods: ['GET', 'PATCH'], body: { name: 'Updated', requires_approval: false } },
  { name: 'invite-preview', path: `${cachePath}/invite/preview`, methods: ['GET'] },
  { name: 'invite-rotate', path: `${cachePath}/invite/rotate`, methods: ['POST'], body: {} },
  { name: 'join', path: `${cachePath}/join`, methods: ['POST'], body: { secret } },
  { name: 'leave', path: `${cachePath}/leave`, methods: ['POST'], body: {} },
  { name: 'join-queue', path: `${cachePath}/join-requests`, methods: ['GET'] },
  { name: 'join-approve', path: `${cachePath}/join-requests/${applicant}/approve`, methods: ['POST'], body: {} },
  { name: 'join-reject', path: `${cachePath}/join-requests/${applicant}/reject`, methods: ['POST'], body: {} },
  { name: 'member-remove', path: `${cachePath}/members/${member}`, methods: ['DELETE'], body: {} },
  { name: 'cache-items', path: `${cachePath}/items`, methods: ['GET', 'POST'], body: { title: 'Created', is_consumable: true, quantity: 5 } },
  { name: 'cache-item', path: itemPath, methods: ['GET', 'PATCH', 'DELETE'], body: { title: 'Updated', quantity: 8 } },
  { name: 'cache-photo', path: `${itemPath}/photo`, methods: ['GET', 'POST'], binary: true },
  { name: 'cache-item-requests', path: `${itemPath}/requests`, methods: ['GET', 'POST'], body: { quantity: 2 } },
  { name: 'cache-approve', path: `${cachePath}/requests/${pendingRequest}/approve`, methods: ['POST'], body: { approval_message: 'Ready', mark_lent_out: false } },
  { name: 'cache-reject', path: `${cachePath}/requests/${pendingRequest}/reject`, methods: ['POST'], body: { reason: 'Not today' } },
  { name: 'request-detail', path: requestPath, methods: ['GET'] },
  { name: 'approved-contact', path: `/api/me/requests/${approvedRequest}/contact`, methods: ['GET'] },
  { name: 'own-approve', path: `${requestPath}/approve`, methods: ['POST'], body: { approval_message: 'Ready', mark_lent_out: false } },
  { name: 'own-reject', path: `${requestPath}/reject`, methods: ['POST'], body: { reason: 'Not today' } },
  { name: 'reusable-approve', path: `/api/me/requests/${reusableRequest}/approve`, methods: ['POST'], body: { approval_message: '', mark_lent_out: true, unavailable_note: 'With a neighbor' } },
  { name: 'auth-send-code', path: '/api/auth/email-otp/send-verification-otp', methods: ['POST'], body: { email: 'signin@example.test', type: 'sign-in' } },
  { name: 'auth-code', path: '/api/auth/sign-in/email-otp', methods: ['POST'], body: { email: 'signin@example.test', otp: '123456' } },
  { name: 'auth-send-link', path: '/api/auth/sign-in/magic-link', methods: ['POST'], body: { email: 'signin@example.test', callbackURL: '/' } },
  { name: 'auth-link-verify', path: '/api/auth/magic-link/verify', methods: ['POST'], body: { token: 'A'.repeat(32), callbackURL: '/' } },
  { name: 'auth-session', path: '/api/auth/get-session', methods: ['GET'] },
  { name: 'auth-sign-out', path: '/api/auth/sign-out', methods: ['POST'], body: {} },
  { name: 'unknown-api', path: '/api/missing', methods: [] },
  { name: 'unknown-auth', path: '/api/auth/missing', methods: [] },
  { name: 'wrong-item-alias', path: `${privatePath}/requests`, methods: [] },
  { name: 'removed-join-wrong-secret', path: `${cachePath}/join`, methods: ['POST'], body: { secret: 'wrong' } },
  { name: 'invalid-push-origin', path: '/api/push/subscribe', methods: ['POST'], body: { ...subscription, endpoint: 'https://127.0.0.1/private' } },
  { name: 'public-root', path: '/', methods: ['GET'] },
  { name: 'public-join', path: `/join/${cache}.${secret}`, methods: ['GET'] },
  { name: 'public-auth-link', path: '/auth/link', methods: ['GET'] },
]
const callers = [
  { name: 'signed-out', id: undefined }, { name: 'unnamed', id: unnamed },
  { name: 'member', id: member }, { name: 'owner', id: owner },
  { name: 'non-member', id: stranger }, { name: 'removed', id: removed },
  { name: 'pending-member', id: applicant }, { name: 'unverified-member', id: unverified },
  { name: 'bad-origin', id: owner, origin: 'https://foreign.test' },
  { name: 'missing-origin', id: owner, origin: null }, { name: 'null-origin', id: owner, origin: 'null' },
  { name: 'missing-turnstile', id: owner, noTurnstile: true },
]

async function seed() {
  const tables = ['outbox', 'r2_cleanup', 'user_contacts', 'user_photos', 'push_subscriptions', 'write_limits', 'requests', 'item_caches', 'items', 'memberships', 'caches', 'session', 'account', 'verification', 'rateLimit', 'user']
  await env.DB.batch(tables.map(table => env.DB.prepare(`DELETE FROM "${table}"`)))
  const statements: D1PreparedStatement[] = []
  for (const [index, id] of actors.entries()) {
    statements.push(env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name,plan,cat_coat) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, '', `user${index}@example.test`, id === unverified ? 0 : 1, stamp, stamp, id === unnamed ? null : `Neighbor ${index}`, id === owner ? 'plus' : 'free', 'grey'))
    statements.push(env.DB.prepare('INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES (?,?,?,?,?,?)')
      .bind(`session-${index}`, '2030-12-31T00:00:00.000Z', `response-${id}`, stamp, stamp, id))
    statements.push(env.DB.prepare('INSERT INTO user_photos(user_id,photo_path,operation_token) VALUES (?,?,?)').bind(id, `users/${id}/${photo}`, 'seed'))
    statements.push(env.DB.prepare('INSERT INTO user_contacts(user_id,kind,value) VALUES (?,\'sms\',\'+15550141111\')').bind(id))
  }
  statements.push(env.DB.prepare('INSERT INTO caches(id,name,created_at,join_secret,requires_approval) VALUES (?,?,?,?,1)').bind(cache, 'Tools', now - 10000, secret))
  for (const [index, id] of actors.entries()) {
    if (id === stranger) continue
    statements.push(env.DB.prepare('INSERT INTO memberships(cache_id,user_id,role,status,created_at) VALUES (?,?,?,?,?)')
      .bind(cache, id, id === owner ? 'owner' : 'member', id === removed ? 'removed' : id === applicant ? 'pending' : 'active', now - 9000 + index))
  }
  statements.push(env.DB.prepare('INSERT INTO items(id,owner_id,title,description,is_consumable,quantity,available,photo_path,created_at) VALUES (?,?,?,?,1,10,1,?,?)')
    .bind(item, owner, 'Starter', 'Shared stock', `${owner}/${item}/${photo}`, now - 8000))
  statements.push(env.DB.prepare('INSERT INTO items(id,owner_id,title,is_consumable,quantity,available,created_at) VALUES (?,?,?,0,NULL,1,?)').bind(reusable, owner, 'Drill', now - 7000))
  statements.push(env.DB.prepare('INSERT INTO item_caches(item_id,cache_id,attached_at) VALUES (?,?,?),(?,?,?)').bind(item, cache, now - 6000, reusable, cache, now - 6000))
  statements.push(env.DB.prepare('INSERT INTO requests(id,item_id,cache_id,requester_id,quantity,status,created_at,creation_token) VALUES (?,?,?,?,2,\'pending\',?,\'seed-pending\')').bind(pendingRequest, item, cache, member, now - 5000))
  statements.push(env.DB.prepare('INSERT INTO requests(id,item_id,cache_id,requester_id,quantity,status,created_at,decided_at,approval_message,creation_token) VALUES (?,?,?,?,1,\'approved\',?,?,\'Private note\',\'seed-approved\')').bind(approvedRequest, item, cache, member, now - 5000, now - 4000))
  statements.push(env.DB.prepare('INSERT INTO requests(id,item_id,cache_id,requester_id,quantity,status,created_at,creation_token) VALUES (?,?,?,?,NULL,\'pending\',?,\'seed-reusable\')').bind(reusableRequest, reusable, cache, member, now - 3000))
  await env.DB.batch(statements)
}

it('matches the frozen parent response fixture across routes, methods and caller/guard states using real D1', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now)
  let nextId = 0
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `ffffffff-ffff-4fff-8fff-${String(++nextId).padStart(12, '0')}`)
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array) new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(7)
    return array
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input) === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      const token = new URLSearchParams(init?.body as URLSearchParams).get('response')
      return Response.json({ success: true, action: token === 'fixture-signin' ? 'signin' : 'create_cache', hostname: 'communalcache.com' })
    }
    expect(String(input)).toBe('https://api.resend.com/emails')
    return Response.json({ id: 'mail-fixture' })
  })
  const bindings = {
    ...env,
    ASSETS: { fetch: async () => new Response('<app/>', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=0' } }) },
    NOTIFICATIONS: { send: async () => {}, sendBatch: async () => {} },
  } as unknown as Env
  const cookies = new Map<string, string>()
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.BETTER_AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  for (const id of actors) {
    const token = `response-${id}`, signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token)))
    cookies.set(id, `__Secure-better-auth.session_token=${encodeURIComponent(token + '.' + btoa(String.fromCharCode(...signature)))}`)
    await env.BUCKET.put(`users/${id}/${photo}`, jpeg, { httpMetadata: { contentType: 'image/jpeg' } })
  }
  await env.BUCKET.put(`${owner}/${item}/${photo}`, jpeg, { httpMetadata: { contentType: 'image/jpeg' } })
  const templates: unknown[] = [], templateKeys = new Map<string, number>(), cells: number[] = [], labels: string[] = []
  try {
    for (const caller of callers) {
      await seed()
      const matrix = routes.flatMap(route => {
        const disallowed = ['PUT', 'PATCH', 'DELETE', 'POST', 'GET'].find(method => !route.methods.includes(method))!
        return [...route.methods, disallowed].map(method => ({ route, method }))
      }).sort((a, b) => Number(writes.has(a.method)) - Number(writes.has(b.method)))
      for (const { route, method } of matrix) {
        if (writes.has(method)) await seed()
        nextId = 0
        const headers = new Headers({ 'CF-Connecting-IP': '192.0.2.1', 'X-Invite-Secret': secret })
        if (caller.id) headers.set('Cookie', cookies.get(caller.id)!)
        if (caller.origin !== null) headers.set('Origin', caller.origin ?? base)
        if (!caller.noTurnstile) headers.set('X-Turnstile-Token', route.path === '/api/caches' ? 'fixture-create-cache' : 'fixture-signin')
        let body: BodyInit | undefined
        if (writes.has(method)) {
          headers.set('Content-Type', route.binary && method === 'POST' ? 'image/jpeg' : 'application/json')
          body = route.binary && method === 'POST' ? jpeg : JSON.stringify(route.body ?? {})
        }
        const response = await worker.fetch(new Request(base + route.path, { method, headers, body }), bindings)
        const type = response.headers.get('Content-Type')
        const record = {
          status: response.status,
          headers: {
            cacheControl: response.headers.get('Cache-Control'), contentType: type,
            setCookie: response.headers.has('Set-Cookie'), location: response.headers.get('Location'),
            referrerPolicy: response.headers.get('Referrer-Policy'), nosniff: response.headers.get('X-Content-Type-Options'),
          },
          body: type?.includes('application/json') ? await response.json() : type?.startsWith('image/') ? [...new Uint8Array(await response.arrayBuffer())] : await response.text(),
        }
        const serialized = JSON.stringify(record)
        if (!templateKeys.has(serialized)) { templateKeys.set(serialized, templates.length); templates.push(record) }
        cells.push(templateKeys.get(serialized)!)
        labels.push(`${caller.name}: ${method} ${route.name}`)
      }
    }
    if (!workerResponseFixture.cells.length) console.log('WORKER_PARITY_FIXTURE:' + JSON.stringify({ templates, cells, labels }))
    expect(cells.length).toBe(workerResponseFixture.cells.length)
    for (const [index, expected] of workerResponseFixture.cells.entries()) {
      const actual = templates[cells[index]] as { status: number; headers: unknown; body: unknown }
      const [status, headerIndex, bodyHash] = workerResponseFixture.templates[expected]
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(actual.body))))
      const actualHash = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')
      expect(actual.status, labels[index]).toBe(status)
      expect(actual.headers, labels[index]).toEqual(workerResponseFixture.headers[headerIndex])
      expect(actualHash, labels[index]).toBe(bodyHash)
    }
  } finally { vi.useRealTimers() }
}, 180_000)
