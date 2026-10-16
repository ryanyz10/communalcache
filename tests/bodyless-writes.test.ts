import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { createCache, createItem, saveContact, setDisplayName } from '../src/db'
import { contactInput } from '../src/contacts'
import { readOptionalBody } from '../src/http'
import { base, login } from './helpers'

async function fixture() {
  const owner = await login('owner@example.test'), member = await login('member@example.test')
  await setDisplayName(env.DB, owner.id, 'Owner')
  await setDisplayName(env.DB, member.id, 'Member')
  const cache = await createCache(env.DB, owner.id, 'Tools', false)
  const removed = crypto.randomUUID(), approved = crypto.randomUUID(), rejected = crypto.randomUUID()
  const now = new Date().toISOString()
  for (const id of [removed, approved, rejected]) {
    await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?,?,?,1,?,?,?)')
      .bind(id, '', `${id}@example.test`, now, now, 'Neighbor').run()
  }
  for (const [id, status] of [[member.id, 'active'], [removed, 'active'], [approved, 'pending'], [rejected, 'pending']]) {
    await env.DB.prepare("INSERT INTO memberships(cache_id,user_id,role,status,created_at) VALUES (?,?,'member',?,?)")
      .bind(cache.id, id, status, Date.now()).run()
  }
  const item = await createItem(env.DB, owner.id, { title: 'Drill', is_consumable: false, quantity: null })
  const cachedItem = await createItem(env.DB, owner.id, { title: 'Mixer', is_consumable: false, quantity: null }, cache.id)
  await saveContact(env.DB, owner.id, contactInput({ kind: 'sms', value: '+14155550148' }))
  const writes = [
    { path: `/api/me/items/${item.id}/attachments/${cache.id}`, method: 'PUT', cookie: owner.cookie, status: 204 },
    { path: `/api/me/items/${item.id}/attachments/${cache.id}`, method: 'DELETE', cookie: owner.cookie, status: 204 },
    { path: `/api/me/items/${item.id}`, method: 'DELETE', cookie: owner.cookie, status: 204 },
    { path: `/api/caches/${cache.id}/items/${cachedItem.id}`, method: 'DELETE', cookie: owner.cookie, status: 204 },
    { path: '/api/me/contact', method: 'DELETE', cookie: owner.cookie, status: 204 },
    { path: `/api/caches/${cache.id}/members/${removed}`, method: 'DELETE', cookie: owner.cookie, status: 204 },
    { path: `/api/caches/${cache.id}/leave`, method: 'POST', cookie: member.cookie, status: 204 },
    { path: `/api/caches/${cache.id}/join-requests/${approved}/approve`, method: 'POST', cookie: owner.cookie, status: 200 },
    { path: `/api/caches/${cache.id}/join-requests/${rejected}/reject`, method: 'POST', cookie: owner.cookie, status: 200 },
    { path: `/api/caches/${cache.id}/invite/rotate`, method: 'POST', cookie: owner.cookie, status: 200 },
  ]
  return { owner, member, cache, removed, approved, rejected, writes }
}

it.each(['missing', 'empty stream with Content-Length: 0', 'JSON object'])('accepts %s at every optional-body Worker write', async shape => {
  const f = await fixture()
  for (const write of f.writes) {
    const headers = new Headers({ Origin: base, Cookie: write.cookie })
    let body: BodyInit | undefined
    if (shape === 'empty stream with Content-Length: 0') {
      headers.set('Content-Length', '0')
      body = new Uint8Array(0)
    } else if (shape === 'JSON object') {
      headers.set('Content-Type', 'application/json; charset=utf-8')
      body = '{}'
    }
    const request = new Request(base + write.path, { method: write.method, headers, body })
    if (shape === 'empty stream with Content-Length: 0') expect(request.body).not.toBeNull()
    const response = await worker.fetch(request, env)
    expect(response.status, `${write.method} ${write.path}`).toBe(write.status)
  }
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM items').first('n')).toBe(0)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user_contacts').first('n')).toBe(0)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM r2_cleanup').first('n')).toBe(2)
  expect(await env.DB.prepare('SELECT status FROM memberships WHERE cache_id=? AND user_id=?').bind(f.cache.id, f.removed).first('status')).toBe('removed')
  expect(await env.DB.prepare('SELECT status FROM memberships WHERE cache_id=? AND user_id=?').bind(f.cache.id, f.member.id).first('status')).toBe('left')
  expect(await env.DB.prepare('SELECT status FROM memberships WHERE cache_id=? AND user_id=?').bind(f.cache.id, f.approved).first('status')).toBe('active')
  expect(await env.DB.prepare('SELECT status FROM memberships WHERE cache_id=? AND user_id=?').bind(f.cache.id, f.rejected).first()).toBeNull()
  expect(await env.DB.prepare('SELECT join_secret FROM caches WHERE id=?').bind(f.cache.id).first('join_secret')).not.toBe(f.cache.invite_token.split('.')[1])
  expect((await env.DB.prepare('SELECT kind FROM outbox ORDER BY kind').all()).results).toEqual([{ kind: 'join_approved' }, { kind: 'join_rejected' }])
})

it.each(['text/plain', null])('rejects nonempty %s bodies at every optional-body write without effects', async contentType => {
  const f = await fixture()
  const tables = ['items', 'item_caches', 'memberships', 'user_contacts', 'outbox', 'r2_cleanup', 'caches']
  const before = await env.DB.batch(tables.map(table => env.DB.prepare(`SELECT * FROM ${table}`)))
  for (const write of f.writes) {
    const headers = new Headers({ Origin: base, Cookie: write.cookie })
    if (contentType) headers.set('Content-Type', contentType)
    const request = new Request(base + write.path, { method: write.method, headers, body: new TextEncoder().encode('not JSON') })
    const response = await worker.fetch(request, env)
    expect(response.status, `${write.method} ${write.path}`).toBe(415)
    expect(await response.json()).toEqual({ error: 'json_required' })
  }
  const after = await env.DB.batch(tables.map(table => env.DB.prepare(`SELECT * FROM ${table}`)))
  expect(after.map(row => row.results)).toEqual(before.map(row => row.results))
})

it.each([
  ['', 400, 'invalid_json'],
  ['{', 400, 'invalid_json'],
  ['[]', 400, 'invalid_json'],
  ['null', 400, 'invalid_json'],
  [' '.repeat(16_385), 413, 'body_too_large'],
])('still validates explicitly JSON bodies (%j)', async (body, status, error) => {
  const f = await fixture(), write = f.writes[0]
  const request = new Request(base + write.path, {
    method: write.method, headers: { Origin: base, Cookie: write.cookie, 'Content-Type': 'application/json' }, body,
  })
  const response = await worker.fetch(request, env)
  expect(response.status).toBe(status)
  expect(await response.json()).toEqual({ error })
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM item_caches').first('n')).toBe(1)
})

it('retains Origin checks before optional-body handling', async () => {
  const f = await fixture()
  for (const write of f.writes) {
    for (const origin of [null, 'null', 'https://foreign.test']) {
      const headers = new Headers({ Cookie: write.cookie, 'Content-Length': '0' })
      if (origin !== null) headers.set('Origin', origin)
      const response = await worker.fetch(new Request(base + write.path, { method: write.method, headers, body: new Uint8Array(0) }), env)
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'invalid_origin' })
    }
  }
})

it('reads only one non-JSON byte before cancelling, even when the source has much more', async () => {
  const cancel = vi.fn()
  const body = new ReadableStream({
    type: 'bytes',
    start(controller) { controller.enqueue(new Uint8Array(65_536)) },
    cancel,
  })
  const request = new Request(base + '/api/me/contact', { method: 'DELETE', body })
  await expect(readOptionalBody(request)).rejects.toMatchObject({ status: 415, code: 'json_required' })
  expect(cancel).toHaveBeenCalledOnce()
  expect(request.bodyUsed).toBe(true)
})
