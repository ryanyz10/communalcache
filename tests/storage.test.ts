import { it, expect } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'

it('creates empty D1 auth/application schemas and records Wrangler migrations idempotently', async () => {
  const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{name:string}>()).results.map(row => row.name)
  for (const table of ['user','session','account','verification','rateLimit','user_photos','plan_limits','caches','memberships','items','item_caches','requests','r2_cleanup','r2_cleanup_cursor','notification_sync_cursor','push_subscriptions','outbox','write_limits','d1_migrations']) expect(tables).toContain(table)
  for (const table of ['my_caches','cache_sync_cursor']) expect(tables).not.toContain(table)
  const columns = (await env.DB.prepare('PRAGMA table_info(user)').all<{name:string;notnull:number}>()).results
  expect(columns.find(column => column.name === 'display_name')?.notnull).toBe(0)
  const migrations = (env as unknown as {TEST_MIGRATIONS:D1Migration[]}).TEST_MIGRATIONS
  await applyD1Migrations(env.DB,migrations)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM d1_migrations').first('n')).toBe(migrations.length)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user').first('n')).toBe(0)
})

it('upgrades existing OTP duplicates deterministically and limits uniqueness to the exact sign-in namespace', async () => {
  const migrations = (env as unknown as {TEST_MIGRATIONS:D1Migration[]}).TEST_MIGRATIONS
  const migration = migrations.find(entry => entry.name.includes('otp_identifier_unique'))!
  await env.DB.exec('DROP INDEX verification_sign_in_otp_identifier_unique')
  await env.DB.prepare('DELETE FROM d1_migrations WHERE name=?').bind(migration.name).run()
  const rows = [
    ['tie-first','sign-in-otp-upgrade@example.test','2026-10-08T02:00:00.000Z'],
    ['older','sign-in-otp-upgrade@example.test','2026-10-08T01:00:00.000Z'],
    ['tie-last','sign-in-otp-upgrade@example.test','2026-10-08T02:00:00.000Z'],
    ['other-first','email-verification-otp-upgrade@example.test','2026-10-08T02:00:00.000Z'],
    ['other-last','email-verification-otp-upgrade@example.test','2026-10-08T02:00:00.000Z'],
    ['loose-first','not-sign-in-otp-upgrade@example.test','2026-10-08T02:00:00.000Z'],
    ['loose-last','not-sign-in-otp-upgrade@example.test','2026-10-08T02:00:00.000Z'],
  ]
  await env.DB.batch(rows.map(([id,identifier,createdAt]) => env.DB.prepare('INSERT INTO verification(id,identifier,value,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').bind(id,identifier,'hashed-fixture:0','2026-10-08T03:00:00.000Z',createdAt,createdAt)))
  await applyD1Migrations(env.DB,[migration])
  expect(await env.DB.prepare('SELECT id FROM verification WHERE identifier=?').bind('sign-in-otp-upgrade@example.test').first('id')).toBe('tie-last')
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM verification').first('n')).toBe(5)
  await expect(env.DB.prepare('INSERT INTO verification(id,identifier,value,expiresAt,createdAt,updatedAt) SELECT ?,identifier,value,expiresAt,createdAt,updatedAt FROM verification WHERE id=?').bind('duplicate','tie-last').run()).rejects.toThrow('UNIQUE constraint failed: verification.identifier')
  const index = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE name='verification_sign_in_otp_identifier_unique'").first<string>('sql')
  expect(index).toContain("WHERE identifier GLOB 'sign-in-otp-*'")
})
