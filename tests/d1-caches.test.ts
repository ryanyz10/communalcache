import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, createScheduledController, type D1Migration } from 'cloudflare:test'
import worker from '../src/index'
import { cacheDetail, cacheJoinRequests, createCache, decideCacheJoin, joinCache, listMyCaches, updateCache } from '../src/db'
import { appRequest, login } from './helpers'

async function user(name = 'Neighbor') {
  const id = crypto.randomUUID(), now = new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?,?,?,1,?,?,?)')
    .bind(id, '', `${id}@example.test`, now, now, name).run()
  return id
}
async function created(approval = false) {
  const owner = await user('Owner'), applicant = await user()
  const info = await createCache(env.DB, owner, 'Tools', approval)
  return { ...info, owner, applicant, secret: info.invite_token.split('.')[1] }
}
function notifications() { return env.DB.prepare('SELECT id,kind,payload FROM outbox ORDER BY created_at,id').all<{ id: string; kind: string; payload: string }>() }

it('upgrades legacy registry rows additively without migrating or granting DO membership', async () => {
  const owner = await user(), id = crypto.randomUUID()
  const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS
  const migration = migrations.find(row => row.name.includes('d1_caches'))!
  await env.DB.exec('DROP TABLE memberships; ALTER TABLE caches DROP COLUMN operation_token; ALTER TABLE caches DROP COLUMN requires_approval; ALTER TABLE caches DROP COLUMN join_secret')
  await env.DB.prepare('DELETE FROM d1_migrations WHERE name=?').bind(migration.name).run()
  await env.DB.prepare('INSERT INTO caches(id,name,created_at) VALUES (?,?,1)').bind(id, 'Legacy').run()
  await applyD1Migrations(env.DB, [migration])
  expect(await env.DB.prepare('SELECT name,join_secret,requires_approval FROM caches WHERE id=?').bind(id).first()).toEqual({ name: 'Legacy', join_secret: null, requires_approval: 0 })
  expect((await listMyCaches(env.DB, owner)).results).toEqual([])
  await expect(cacheDetail(env.DB, id, owner)).rejects.toMatchObject({ status: 404 })
  expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name='verification_sign_in_otp_identifier_unique'").first('name')).toBeTruthy()
})

it('creates canonical config/owner atomically and appears in Home immediately with no DO or discovery copy', async () => {
  const cache = await created()
  expect(cache.secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(atob(cache.secret.replaceAll('-', '+').replaceAll('_', '/') + '=')).toHaveLength(32)
  const home = [expect.objectContaining({ id: cache.id, name: 'Tools', active_member_count: 1, attached_item_count: 0, pending_answer_count: 0 })]
  expect((await listMyCaches(env.DB, cache.owner)).results).toEqual(home)
  expect((await cacheDetail(env.DB, cache.id, cache.owner)).members).toEqual([{user_id:cache.owner,display_name:'Owner',cat_coat:null,profile_photo_version:null,attached_item_count:0}])
  await worker.scheduled(createScheduledController(), env)
  expect((await listMyCaches(env.DB, cache.owner)).results).toEqual(home)
})

it('enforces owner/status/boolean/FK constraints and rolls creation back on dependent failure', async () => {
  const owner = await user(), second = await user(), cache = await createCache(env.DB, owner, 'Tools', false)
  for (const [role, status] of [['owner', 'active'], ['owner', 'removed'], ['admin', 'active'], ['member', 'invalid']]) {
    await expect(env.DB.prepare('INSERT INTO memberships VALUES (?,?,?,?,1,NULL)').bind(cache.id, second, role, status).run()).rejects.toThrow()
  }
  await expect(env.DB.prepare('INSERT INTO memberships VALUES (?,?,\'member\',\'active\',1,NULL)').bind(cache.id, 'missing').run()).rejects.toThrow()
  await expect(env.DB.prepare('UPDATE caches SET requires_approval=2 WHERE id=?').bind(cache.id).run()).rejects.toThrow()
  await env.DB.exec("CREATE TRIGGER fail_owner BEFORE INSERT ON memberships WHEN NEW.role='owner' BEGIN SELECT RAISE(ABORT,'injected owner failure'); END")
  await expect(createCache(env.DB, second, 'Lost', false)).rejects.toThrow('injected owner failure')
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM caches').first('n')).toBe(1)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM memberships').first('n')).toBe(1)
})

it('joins membership in every cache read and guards owner-only settings/rotation without copied grants', async () => {
  const cache = await created(), pending = await user(), removed = await user(), outsider = await user()
  await joinCache(env.DB, cache.id, cache.applicant, cache.secret)
  for (const [id, status] of [[pending, 'pending'], [removed, 'removed']]) {
    await env.DB.prepare("INSERT INTO memberships VALUES (?,?,'member',?,1,NULL)").bind(cache.id, id, status).run()
  }
  for (const id of [pending, removed, outsider]) {
    expect((await listMyCaches(env.DB, id)).results).toEqual([])
    await expect(cacheDetail(env.DB, cache.id, id)).rejects.toMatchObject({ status: 404 })
    await expect(updateCache(env.DB, cache.id, id, { name: 'Forbidden' })).rejects.toMatchObject({ status: 404 })
    await expect(cacheJoinRequests(env.DB, cache.id, id)).rejects.toMatchObject({ status: 404 })
  }
  await expect(updateCache(env.DB, cache.id, cache.applicant, {}, true)).rejects.toMatchObject({ status: 404 })
  await expect(decideCacheJoin(env.DB, cache.id, cache.applicant, pending, 'approve')).rejects.toMatchObject({ status: 404 })
  expect((await notifications()).results).toEqual([])
  expect(await updateCache(env.DB, cache.id, cache.owner, { name: 'Pantry', requires_approval: true })).toMatchObject({ name: 'Pantry', requires_approval: true })
  expect((await cacheDetail(env.DB, cache.id, cache.applicant)).name).toBe('Pantry')
  expect(JSON.stringify(await cacheDetail(env.DB, cache.id, cache.owner))).not.toContain('example.test')
})

it('serializes concurrent open/gated joins and emits one atomic outbox only for the gated insertion', async () => {
  for (const approval of [false, true]) {
    const cache = await created(approval)
    const results = await Promise.all(Array.from({ length: 12 }, () => joinCache(env.DB, cache.id, cache.applicant, cache.secret)))
    expect(results.every(row => row.membership.status === (approval ? 'pending' : 'active'))).toBe(true)
    expect(results.filter(row => row.notificationId)).toHaveLength(approval ? 1 : 0)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM memberships WHERE cache_id=? AND user_id=?').bind(cache.id, cache.applicant).first('n')).toBe(1)
    if (approval) {
      expect(await cacheJoinRequests(env.DB, cache.id, cache.owner)).toEqual([{user_id:cache.applicant,display_name:'Neighbor',cat_coat:null,created_at:expect.any(Number),profile_photo_version:null}])
      await updateCache(env.DB, cache.id, cache.owner, { requires_approval: false })
      expect((await joinCache(env.DB, cache.id, cache.applicant, cache.secret)).membership.status).toBe('pending')
    }
  }
  const rows = (await notifications()).results
  expect(rows).toHaveLength(1)
  expect(JSON.parse(rows[0].payload)).toMatchObject({ event: 'join_requested', cache_name: 'Tools', recipient_id: expect.any(String) })
  expect(rows[0].payload).not.toContain('example.test')
})

it('rejects stale invite authorization when rotation wins between secret comparison and guarded insertion', async () => {
  const cache = await created(), batch = env.DB.batch.bind(env.DB)
  vi.spyOn(env.DB, 'batch').mockImplementationOnce(async statements => {
    await updateCache(env.DB, cache.id, cache.owner, {}, true)
    return batch(statements)
  })
  await expect(joinCache(env.DB, cache.id, cache.applicant, cache.secret)).rejects.toMatchObject({ status: 404 })
  expect(await env.DB.prepare('SELECT 1 FROM memberships WHERE user_id=?').bind(cache.applicant).first()).toBeNull()
  expect((await notifications()).results).toEqual([])
})

it('uses the current approval setting when it changes after secret comparison, without stale open admission', async () => {
  const cache = await created(), batch = env.DB.batch.bind(env.DB)
  vi.spyOn(env.DB, 'batch').mockImplementationOnce(async statements => {
    await updateCache(env.DB, cache.id, cache.owner, { requires_approval: true })
    return batch(statements)
  })
  expect((await joinCache(env.DB, cache.id, cache.applicant, cache.secret)).membership.status).toBe('pending')
  expect((await notifications()).results).toHaveLength(1)
})

it('compares canonical secrets and preserves removed denial only for a current valid secret', async () => {
  const cache = await created()
  await env.DB.prepare("INSERT INTO memberships VALUES (?,?,'member','removed',1,NULL)").bind(cache.id, cache.applicant).run()
  for (const secret of ['', 'wrong', cache.secret + 'A', (cache.secret[0] === 'A' ? 'E' : 'A') + cache.secret.slice(1), cache.secret.slice(0, -1) + 'B', '/'.repeat(43)]) {
    await expect(joinCache(env.DB, cache.id, cache.applicant, secret)).rejects.toMatchObject({ status: 404 })
  }
  await expect(joinCache(env.DB, cache.id, cache.applicant, cache.secret)).rejects.toMatchObject({ status: 403 })
  const rotated = await updateCache(env.DB, cache.id, cache.owner, {}, true)
  await expect(joinCache(env.DB, cache.id, cache.applicant, cache.secret)).rejects.toMatchObject({ status: 404 })
  await expect(joinCache(env.DB, cache.id, cache.applicant, rotated.invite_token.split('.')[1])).rejects.toMatchObject({ status: 403 })
  expect((await notifications()).results).toEqual([])
})

it('concurrent approve/reject has one winner and token-gated outbox; rejected applicants can retry', async () => {
  const cache = await created(true)
  await joinCache(env.DB, cache.id, cache.applicant, cache.secret)
  const attempts = await Promise.allSettled(['approve', 'reject'].map(action => decideCacheJoin(env.DB, cache.id, cache.owner, cache.applicant, action as 'approve' | 'reject')))
  expect(attempts.filter(row => row.status === 'fulfilled')).toHaveLength(1)
  expect((attempts.find(row => row.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 })
  expect((await notifications()).results.filter(row => row.kind !== 'join_requested')).toHaveLength(1)
  const retrying = await user()
  await joinCache(env.DB, cache.id, retrying, cache.secret)
  const rejected = await decideCacheJoin(env.DB, cache.id, cache.owner, retrying, 'reject')
  expect(await env.DB.prepare('SELECT 1 FROM memberships WHERE cache_id=? AND user_id=?').bind(cache.id, retrying).first()).toBeNull()
  const snapshot = (await notifications()).results.find(row => row.id === rejected.notificationId)!
  expect(JSON.parse(snapshot.payload).recipient_id).toBe(retrying)
  await joinCache(env.DB, cache.id, retrying, cache.secret)
  await decideCacheJoin(env.DB, cache.id, cache.owner, retrying, 'approve')
  const before = (await notifications()).results
  const marker = await env.DB.prepare('SELECT operation_token FROM memberships WHERE cache_id=? AND user_id=?').bind(cache.id,retrying).first('operation_token')
  await expect(decideCacheJoin(env.DB, cache.id, cache.owner, retrying, 'reject')).rejects.toMatchObject({ status: 409 })
  expect((await notifications()).results).toEqual(before)
  expect(await env.DB.prepare('SELECT operation_token FROM memberships WHERE cache_id=? AND user_id=?').bind(cache.id,retrying).first('operation_token')).toBe(marker)
  expect((await cacheDetail(env.DB, cache.id, retrying)).id).toBe(cache.id)
})

it('rolls joins and decisions back on outbox failure and snapshots back on final deletion failure', async () => {
  const cache = await created(true)
  await env.DB.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'injected outbox failure'); END")
  await expect(joinCache(env.DB, cache.id, cache.applicant, cache.secret)).rejects.toThrow('injected outbox failure')
  expect(await cacheJoinRequests(env.DB, cache.id, cache.owner)).toEqual([])
  await env.DB.exec('DROP TRIGGER fail_outbox')
  await joinCache(env.DB, cache.id, cache.applicant, cache.secret)
  const before = (await notifications()).results
  await env.DB.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'injected outbox failure'); END")
  for (const action of ['approve', 'reject'] as const) await expect(decideCacheJoin(env.DB, cache.id, cache.owner, cache.applicant, action)).rejects.toThrow('injected outbox failure')
  await env.DB.exec('DROP TRIGGER fail_outbox')
  await env.DB.exec("CREATE TRIGGER fail_reject BEFORE DELETE ON memberships BEGIN SELECT RAISE(ABORT,'injected delete failure'); END")
  await expect(decideCacheJoin(env.DB, cache.id, cache.owner, cache.applicant, 'reject')).rejects.toThrow('injected delete failure')
  expect((await notifications()).results).toEqual(before)
  expect(await cacheJoinRequests(env.DB, cache.id, cache.owner)).toHaveLength(1)
})

it('retains committed outbox after Queue enqueue failure and Cron rescues it without DO sync', async () => {
  const owner = await login('owner@example.test'), applicant = await login('applicant@example.test')
  for (const caller of [owner, applicant]) await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: caller.cookie, body: { display_name: 'Neighbor' } }), env)
  const cache = await createCache(env.DB, owner.id, 'Tools', true)
  const send = vi.spyOn(env.NOTIFICATIONS, 'send').mockRejectedValue(new Error('injected queue failure'))
  const response = await worker.fetch(appRequest(`/api/caches/${cache.id}/join`, { method: 'POST', cookie: applicant.cookie, body: { secret: cache.invite_token.split('.')[1] } }), env)
  expect(response.status).toBe(200)
  const rows = (await notifications()).results
  expect(rows).toHaveLength(1)
  expect(await cacheJoinRequests(env.DB, cache.id, owner.id)).toHaveLength(1)
  send.mockRestore()
  await env.DB.prepare('UPDATE outbox SET created_at=?').bind(Date.now() - 240_000).run()
  const batch = vi.spyOn(env.NOTIFICATIONS, 'sendBatch')
  await worker.scheduled(createScheduledController(), env)
  expect(batch).toHaveBeenCalledWith([{ body: rows[0].id }])
})

it('guards destructive APIs on missing/protected targets without consulting DO membership', async () => {
  const caller = await login()
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: caller.cookie, body: { display_name: 'Neighbor' } }), env)
  const cache = await createCache(env.DB, caller.id, 'Tools', false), item = crypto.randomUUID()
  const base = `/api/caches/${cache.id}`
  const paths: [string, number][] = [[base + `/items/${item}`,404],[base + `/members/${caller.id}`,409]]
  for (const [path, expected] of paths) {
    const response = await worker.fetch(appRequest(path, { method:'DELETE', cookie:caller.cookie, body:{} }), env)
    expect(response.status).toBe(expected)
    expect(await response.json()).toEqual({ error:expected===404?'not_found':'owner_cannot_be_removed' })
  }
  expect((await notifications()).results).toEqual([])
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM write_limits').first('n')).toBe(0)
})
