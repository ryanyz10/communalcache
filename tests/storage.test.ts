import { it, expect } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, evictDurableObject, runInDurableObject, runDurableObjectAlarm, type D1Migration } from 'cloudflare:test'
import { migrateCache } from '../src/cache'

function cache() { return env.CACHES.get(env.CACHES.newUniqueId()) }

it('creates empty D1 auth/application schemas and records Wrangler migrations idempotently', async () => {
  const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{name: string}>()).results.map(row => row.name)
  for (const table of ['user','session','account','verification','rateLimit','caches','memberships','my_caches','push_subscriptions','outbox','write_limits','d1_migrations']) expect(tables).toContain(table)
  const columns = (await env.DB.prepare('PRAGMA table_info(user)').all<{name: string; notnull: number}>()).results
  expect(columns.find(column => column.name === 'display_name')?.notnull).toBe(0)
  const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS
  await applyD1Migrations(env.DB, migrations)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM d1_migrations').first('n')).toBe(migrations.length)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user').first('n')).toBe(0)
})

it('upgrades existing OTP duplicates deterministically and limits uniqueness to the exact sign-in namespace', async () => {
  const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS
  const migration = migrations.find(entry => entry.name.includes('otp_identifier_unique'))!
  await env.DB.exec('DROP INDEX verification_sign_in_otp_identifier_unique')
  await env.DB.prepare('DELETE FROM d1_migrations WHERE name = ?').bind(migration.name).run()
  const rows = [
    ['tie-first', 'sign-in-otp-upgrade@example.test', '2026-10-08T02:00:00.000Z'],
    ['older', 'sign-in-otp-upgrade@example.test', '2026-10-08T01:00:00.000Z'],
    ['tie-last', 'sign-in-otp-upgrade@example.test', '2026-10-08T02:00:00.000Z'],
    ['other-first', 'email-verification-otp-upgrade@example.test', '2026-10-08T02:00:00.000Z'],
    ['other-last', 'email-verification-otp-upgrade@example.test', '2026-10-08T02:00:00.000Z'],
    ['loose-first', 'not-sign-in-otp-upgrade@example.test', '2026-10-08T02:00:00.000Z'],
    ['loose-last', 'not-sign-in-otp-upgrade@example.test', '2026-10-08T02:00:00.000Z'],
  ]
  await env.DB.batch(rows.map(([id, identifier, createdAt]) => env.DB.prepare('INSERT INTO verification(id, identifier, value, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').bind(id, identifier, 'hashed-fixture:0', '2026-10-08T03:00:00.000Z', createdAt, createdAt)))
  await applyD1Migrations(env.DB, [migration])
  expect(await env.DB.prepare('SELECT id FROM verification WHERE identifier = ?').bind('sign-in-otp-upgrade@example.test').first('id')).toBe('tie-last')
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM verification').first('n')).toBe(5)
  await expect(env.DB.prepare('INSERT INTO verification(id, identifier, value, expiresAt, createdAt, updatedAt) SELECT ?, identifier, value, expiresAt, createdAt, updatedAt FROM verification WHERE id = ?').bind('duplicate', 'tie-last').run()).rejects.toThrow('UNIQUE constraint failed: verification.identifier')
  const index = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE name = 'verification_sign_in_otp_identifier_unique'").first<string>('sql')
  expect(index).toContain("WHERE identifier GLOB 'sign-in-otp-*'")
})

it('finishes versioned constructor migration before the first RPC', async () => {
  const stub = cache()
  expect(await stub.schemaVersion()).toBe(2)
  const tables = await runInDurableObject(stub, (_instance, state) => state.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map(row => row.name))
  for (const table of ['schema_version','cache_config','members','items','requests','pending_sync']) expect(tables).toContain(table)
  expect(await stub.schemaVersion()).toBe(2)
})

it('upgrades persisted v1 to v2 in the constructor without losing old data', async () => {
  const stub = cache()
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec('DROP TABLE pending_sync; UPDATE schema_version SET version = 1;')
    state.storage.sql.exec('INSERT INTO members(user_id, role, status, created_at) VALUES (?, ?, ?, ?)', 'owner', 'owner', 'active', 1)
  })
  await evictDurableObject(stub)
  expect(await stub.schemaVersion()).toBe(2)
  const owner = await runInDurableObject(stub, (_instance, state) => state.storage.sql.exec<{user_id:string}>('SELECT user_id FROM members').one().user_id)
  expect(owner).toBe('owner')
})

it('does not stamp the new version when a migration fails', async () => {
  const stub = cache()
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec('UPDATE schema_version SET version = 1')
    // Existing v2 table deliberately collides with the v1→v2 CREATE.
    expect(() => migrateCache(state.storage)).toThrow()
    expect(state.storage.sql.exec<{version:number}>('SELECT version FROM schema_version').one().version).toBe(1)
  })
})

it('rolls back partial DDL and version metadata when fresh migration fails', async () => {
  const stub = cache()
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec('DROP TABLE requests; DROP TABLE items; DROP TABLE members; DROP TABLE cache_config; DROP TABLE pending_sync; DROP TABLE schema_version;')
    state.storage.sql.exec('CREATE TABLE items (collision TEXT)')
    expect(() => migrateCache(state.storage)).toThrow()
    const tables = state.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map(row => row.name)
    expect(tables).not.toContain('cache_config')
    expect(tables).not.toContain('members')
    expect(tables).not.toContain('schema_version')
    state.storage.sql.exec('DROP TABLE items')
    migrateCache(state.storage)
  })
  expect(await stub.schemaVersion()).toBe(2)
})

it('rolls back mutation and durable intent together on a thrown transaction', async () => {
  const stub = cache()
  await runInDurableObject(stub, (_instance, state) => {
    expect(() => state.storage.transactionSync(() => {
      state.storage.sql.exec('INSERT INTO members(user_id, role, status, created_at) VALUES (?, ?, ?, ?)', 'user', 'member', 'active', 1)
      state.storage.sql.exec('INSERT INTO pending_sync(id, kind, payload, created_at) VALUES (?, ?, ?, ?)', 'intent', 'test', '{}', 1)
      throw new Error('injected failure')
    })).toThrow('injected failure')
    expect(state.storage.sql.exec('SELECT 1 FROM members').toArray()).toHaveLength(0)
    expect(state.storage.sql.exec('SELECT 1 FROM pending_sync').toArray()).toHaveLength(0)
  })
})

it('enforces owner, stock, request and foreign-key constraints in local SQLite', async () => {
  const stub = cache()
  await runInDurableObject(stub, (_instance, state) => {
    const sql = state.storage.sql
    sql.exec("INSERT INTO members VALUES ('owner','owner','active',1), ('member','member','active',1)")
    expect(() => sql.exec("INSERT INTO members VALUES ('second','owner','active',1)")).toThrow()
    expect(() => sql.exec("INSERT INTO members VALUES ('removed-owner','owner','removed',1)")).toThrow()
    sql.exec("INSERT INTO items(id,owner_id,title,is_consumable,quantity,created_at) VALUES ('stock','owner','Sugar',1,0,1), ('tool','owner','Mixer',0,NULL,1)")
    for (const quantity of [-1, 10000, 1.5, null]) expect(() => sql.exec('UPDATE items SET quantity = ? WHERE id = ?',quantity,'stock')).toThrow()
    expect(() => sql.exec("UPDATE items SET quantity = 1 WHERE id = 'tool'")).toThrow()
    expect(() => sql.exec("INSERT INTO items(id,owner_id,title,is_consumable,quantity,created_at) VALUES ('bad','non-member','Sugar',1,1,1)")).toThrow()
    expect(() => sql.exec("INSERT INTO requests VALUES ('bad','stock','member',0,'pending',NULL,NULL,1)")).toThrow()
    expect(() => sql.exec("INSERT INTO requests VALUES ('bad','stock','member',1,'approved',NULL,NULL,1)")).toThrow()
    expect(() => sql.exec("INSERT INTO requests VALUES ('bad','stock','member',1,'rejected',NULL,2,1)")).toThrow()
    sql.exec("INSERT INTO requests VALUES ('good','stock','member',1,'pending',NULL,NULL,1)")
    sql.exec("DELETE FROM items WHERE id = 'stock'")
    expect(sql.exec('SELECT 1 FROM requests').toArray()).toHaveLength(0)
  })
})

it('alarms preserve future intents and re-arm until a later feature can consume them', async () => {
  const stub = cache()
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec('INSERT INTO pending_sync(id,kind,payload,created_at) VALUES (?, ?, ?, ?)', 'intent', 'future', '{}', 1)
    await state.storage.setAlarm(Date.now()+60_000)
  })
  expect(await runDurableObjectAlarm(stub)).toBe(true)
  await runInDurableObject(stub, async (_instance, state) => {
    expect(state.storage.sql.exec('SELECT 1 FROM pending_sync').toArray()).toHaveLength(1)
    expect(await state.storage.getAlarm()).not.toBeNull()
    await state.storage.deleteAlarm()
  })
  await stub.schemaVersion()
  await runInDurableObject(stub, async (_instance, state) => {
    expect(await state.storage.getAlarm()).not.toBeNull()
    state.storage.sql.exec('DELETE FROM pending_sync')
  })
  expect(await runDurableObjectAlarm(stub)).toBe(true)
  expect(await runDurableObjectAlarm(stub)).toBe(false)
})
