import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, reset, type D1Migration } from 'cloudflare:test'
import worker from '../src/index'
import { featureEnabled } from '../src/db'
import { appRequest } from './helpers'

it('seeds the Google switch enabled with millisecond metadata and constrains its key and boolean state', async () => {
  const row = await env.DB.prepare('SELECT key,enabled,updated_at,updated_by FROM feature_flags').first<{ key: string; enabled: number; updated_at: number; updated_by: string | null }>()
  expect(row).toMatchObject({ key: 'google_sign_in', enabled: 1, updated_by: null })
  expect(Number.isInteger(row!.updated_at)).toBe(true)
  expect(row!.updated_at).toBeGreaterThan(1_000_000_000_000)
  for (const key of ['unknown', null]) await expect(env.DB.prepare('INSERT INTO feature_flags(key,enabled,updated_at) VALUES (?,1,1)').bind(key).run()).rejects.toThrow()
  for (const enabled of [2, -1, null, 'true']) await expect(env.DB.prepare("UPDATE feature_flags SET enabled=? WHERE key='google_sign_in'").bind(enabled).run()).rejects.toThrow()
  expect(await featureEnabled(env.DB, 'google_sign_in')).toBe(true)
  expect(await featureEnabled(env.DB, 'unknown')).toBe(false)
  await env.DB.prepare("DELETE FROM feature_flags WHERE key='google_sign_in'").run()
  expect(await featureEnabled(env.DB, 'google_sign_in')).toBe(false)
})

it('adds feature switches to a populated database without changing existing users, sessions or counters', async () => {
  const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS
  const index = migrations.findIndex(migration => migration.name.includes('feature_flags'))
  await reset(); await applyD1Migrations(env.DB, migrations.slice(0, index))
  const id = crypto.randomUUID(), stamp = new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)').bind(id, '', 'upgrade-fixture@example.test', stamp, stamp).run()
  await env.DB.prepare('INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES (?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), '2030-01-01T00:00:00.000Z', 'public-test-session', stamp, stamp, id).run()
  await env.DB.prepare("INSERT INTO write_limits VALUES (?,'photo_upload',600000,3)").bind(id).run()
  const tables = ['user', 'session', 'write_limits']
  const before = await Promise.all(tables.map(async table => (await env.DB.prepare(`SELECT * FROM ${table}`).all()).results))
  await applyD1Migrations(env.DB, [migrations[index]])
  const after = await Promise.all(tables.map(async table => (await env.DB.prepare(`SELECT * FROM ${table}`).all()).results))
  expect(after).toEqual(before)
  expect(await featureEnabled(env.DB, 'google_sign_in')).toBe(true)
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
})

it('fails closed before Better Auth if the feature table is unavailable', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  const configured = { ...env, GOOGLE_CLIENT_ID: 'fixture-google', GOOGLE_CLIENT_SECRET: 'test-only-public-fixture' }
  await env.DB.exec('DROP TABLE feature_flags')
  for (const request of [
    appRequest('/api/config'),
    appRequest('/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google' } }),
    appRequest('/api/auth/callback/google?state=untrusted&code=untrusted'),
  ]) {
    const response = await worker.fetch(request, configured)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal_error' })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  }
  expect(fetch).not.toHaveBeenCalled()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM verification').first('n')).toBe(0)
})
