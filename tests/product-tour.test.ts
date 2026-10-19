import { expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, reset, type D1Migration } from 'cloudflare:test'
import worker from '../src/index'
import { getProfile } from '../src/db'
import { appRequest, login } from './helpers'

it('adds nullable integer tour completion to populated D1 without changing the existing profile', async () => {
  const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS
  const migration = migrations.find(row => row.name.includes('0018_product_tour'))!
  await reset()
  await applyD1Migrations(env.DB, migrations.filter(row => row !== migration))
  const now = new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name,cat_coat) VALUES (?,?,?,1,?,?,?,?)')
    .bind('existing', '', 'existing@example.test', now, now, 'Existing', 'grey').run()
  await applyD1Migrations(env.DB, [migration])
  await applyD1Migrations(env.DB, [migration])
  expect(await getProfile(env.DB, 'existing')).toMatchObject({ display_name: 'Existing', cat_coat: 'grey', tour_completed_at: null })
  for (const value of [-1, 1.5, 'invalid']) await expect(env.DB.prepare('UPDATE user SET tour_completed_at=? WHERE id=?').bind(value, 'existing').run()).rejects.toThrow('CHECK')
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
})

it('sets and clears completion for the caller only, including before name setup, and preserves it on name edits', async () => {
  const caller = await login(), other = await login('other@example.test')
  const patch = (body: unknown) => worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: caller.cookie, body }), env)
  expect((await getProfile(env.DB, caller.id))?.tour_completed_at).toBeNull()
  const before = Date.now()
  const completed = await patch({ tour_completed: true, id: other.id, user_id: other.id })
  expect(completed.status).toBe(200)
  expect(completed.headers.get('Cache-Control')).toBe('no-store')
  const profile = await completed.json() as { id: string; tour_completed_at: number }
  expect(profile.id).toBe(caller.id)
  expect(profile.tour_completed_at).toBeGreaterThanOrEqual(before)
  expect(profile.tour_completed_at).toBeLessThanOrEqual(Date.now())
  expect((await getProfile(env.DB, other.id))?.tour_completed_at).toBeNull()
  expect(await (await patch({ display_name: 'Neighbor' })).json()).toMatchObject({ tour_completed_at: profile.tour_completed_at })
  expect(await (await worker.fetch(appRequest('/api/me', { cookie: caller.cookie }), env)).json()).toMatchObject({ tour_completed_at: profile.tour_completed_at })
  expect(await (await patch({ tour_completed: false })).json()).toMatchObject({ tour_completed_at: null, display_name: 'Neighbor' })
  expect((await getProfile(env.DB, other.id))?.tour_completed_at).toBeNull()
})

it('rejects invalid completion before any profile write and requires the session and exact Origin', async () => {
  const caller = await login()
  for (const value of [null, 0, 1, 'true', {}, []]) {
    const response = await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: caller.cookie, body: { tour_completed: value, display_name: 'Must not save' } }), env)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_tour_completed' })
    expect(await getProfile(env.DB, caller.id)).toMatchObject({ display_name: null, tour_completed_at: null })
  }
  for (const origin of [null, 'null', 'https://foreign.test']) expect((await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: caller.cookie, origin, body: { tour_completed: true } }), env)).status).toBe(403)
  expect((await worker.fetch(appRequest('/api/me', { method: 'PATCH', body: { tour_completed: true } }), env)).status).toBe(401)
  expect((await getProfile(env.DB, caller.id))?.tour_completed_at).toBeNull()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first('n')).toBe(0)
})
