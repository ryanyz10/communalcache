import { it, expect } from 'vitest'
import { env } from 'cloudflare:workers'
import { runInDurableObject, runDurableObjectAlarm, abortAllDurableObjects } from 'cloudflare:test'
import worker from '../src/index'
import { appRequest, login } from './helpers'

function cache(id = crypto.randomUUID()) { return { id, stub: env.CACHES.get(env.CACHES.idFromName(id)) } }
async function user(name = 'Neighbor') {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO user(id, name, email, emailVerified, createdAt, updatedAt, display_name) VALUES (?, ?, ?, 1, ?, ?, ?)')
    .bind(id, '', `${id}@example.test`, new Date().toISOString(), new Date().toISOString(), name).run()
  return id
}
async function created(approval = false) {
  const owner = await user('Owner'), applicant = await user()
  const { id, stub } = cache()
  const info = await stub.create(id, owner, 'Tools', approval)
  return { id, stub, owner, applicant, secret: info.invite_token.split('.')[1] }
}
async function failure(call: PromiseLike<unknown>, message: string) {
  let error: unknown
  try { await call } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain(message)
}
async function intents(stub: ReturnType<typeof cache>['stub']) {
  return runInDurableObject(stub, (_instance, state) => state.storage.sql.exec<{ id: string; kind: string; payload: string }>('SELECT id, kind, payload FROM pending_sync ORDER BY sequence').toArray())
}

it('open joins are immediately active and concurrent replays create one membership and discovery intent', async () => {
  const { id, stub, owner, applicant, secret } = await created()
  const results = await Promise.all([stub.join(applicant, secret), stub.join(applicant, secret)])
  expect(results).toEqual([{ cache_id: id, name: 'Tools', status: 'active' }, { cache_id: id, name: 'Tools', status: 'active' }])
  expect((await stub.detail(applicant)).members.map(row => row.user_id)).toContain(applicant)
  expect((await intents(stub)).map(row => row.kind)).toEqual(['registry_upsert', 'discovery_upsert', 'discovery_upsert'])
  expect(await stub.join(owner, secret)).toMatchObject({ status: 'active' })
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM my_caches').first('n')).toBe(0)
  await stub.flushSync()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM my_caches WHERE user_id = ? AND cache_id = ?').bind(applicant, id).first('n')).toBe(1)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first('n')).toBe(0)
})

it('gated joins replay without duplicate notifications and remain pending when approval is switched off', async () => {
  const { id, stub, owner, applicant, secret } = await created(true)
  await Promise.all([stub.join(applicant, secret), stub.join(applicant, secret)])
  const notifications = (await intents(stub)).filter(row => row.kind === 'notification')
  expect(notifications).toHaveLength(1)
  expect(JSON.parse(notifications[0].payload)).toEqual({ event: 'join_requested', cache_id: id, cache_name: 'Tools', recipient_id: owner, user_id: applicant })
  await failure(stub.detail(applicant), 'not_found')
  await failure(stub.joinRequests(applicant), 'not_found')
  expect(await stub.joinRequests(owner)).toEqual([{ user_id: applicant, created_at: expect.any(Number) }])
  await stub.update(owner, { requires_approval: false })
  expect(await stub.join(applicant, secret)).toMatchObject({ status: 'pending' })
  await stub.flushSync()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM my_caches WHERE user_id = ?').bind(applicant).first('n')).toBe(0)
  const outbox = await env.DB.prepare('SELECT kind, payload FROM outbox').first<{ kind: string; payload: string }>()
  expect(outbox?.kind).toBe('join_requested')
  expect(JSON.parse(outbox!.payload).recipient_id).toBe(owner)
  expect(outbox!.payload).not.toContain(secret)
  expect(outbox!.payload).not.toContain('example.test')
})

it('compares canonical decoded secrets, denies removed users only after a valid secret, and invalidates rotated links', async () => {
  const { stub, owner, applicant, secret } = await created()
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec("INSERT INTO members VALUES (?, 'member', 'removed', 1)", applicant)
  })
  const firstMismatch = (secret[0] === 'A' ? 'B' : 'A') + secret.slice(1)
  const lastMismatch = secret.slice(0, -1) + (secret.endsWith('A') ? 'E' : 'A')
  const nonCanonical = secret.slice(0, -1) + 'B'
  for (const bad of ['', secret.slice(1), secret + 'A', firstMismatch, lastMismatch, nonCanonical, 'x'.repeat(100), '/'.repeat(43)]) {
    await failure(stub.join(applicant, bad), 'not_found')
  }
  await failure(stub.join(applicant, secret), 'member_removed')
  await failure(stub.detail(applicant), 'not_found')
  const rotated = (await stub.rotateInvite(owner)).invite_token.split('.')[1]
  await failure(stub.join(owner, secret), 'not_found')
  expect(await stub.join(owner, rotated)).toMatchObject({ status: 'active' })
  await failure(cache().stub.join(applicant, rotated), 'not_found')
  await runInDurableObject(stub, (_instance, state) => {
    expect(state.storage.sql.exec('SELECT status FROM members WHERE user_id = ?', applicant).one().status).toBe('removed')
  })
  expect(await intents(stub)).toHaveLength(2)
})

it('owner decisions are pending-only, concurrent approve/reject has one winner, and rejection permits another join', async () => {
  const { id, stub, owner, applicant, secret } = await created(true)
  await stub.join(applicant, secret)
  for (const caller of ['outsider', applicant]) {
    await failure(stub.joinRequests(caller), 'not_found')
    await failure(stub.decideJoin(caller, applicant, 'approve'), 'not_found')
    await failure(stub.decideJoin(caller, applicant, 'reject'), 'not_found')
  }
  const other = await user()
  await stub.update(owner, { requires_approval: false })
  await stub.join(other, secret)
  await failure(stub.decideJoin(other, applicant, 'approve'), 'not_found')
  await failure(cache().stub.decideJoin(owner, applicant, 'approve'), 'not_found')
  const attempts = await Promise.allSettled([
    Promise.resolve(stub.decideJoin(owner, applicant, 'approve')),
    Promise.resolve(stub.decideJoin(owner, applicant, 'reject')),
  ])
  expect(attempts.filter(row => row.status === 'fulfilled')).toHaveLength(1)
  expect((attempts.find(row => row.status === 'rejected') as PromiseRejectedResult).reason.message).toContain('join_not_pending')
  await failure(stub.decideJoin(owner, applicant, 'approve'), 'join_not_pending')
  const decisionIntents = (await intents(stub)).filter(row => row.kind === 'notification' && JSON.parse(row.payload).event !== 'join_requested')
  expect(decisionIntents).toHaveLength(1)
  expect(JSON.parse(decisionIntents[0].payload).recipient_id).toBe(applicant)
  const retrying = await user()
  await stub.update(owner, { requires_approval: true })
  await stub.join(retrying, secret)
  await stub.decideJoin(owner, retrying, 'reject')
  await runInDurableObject(stub, (_instance, state) => {
    expect(state.storage.sql.exec('SELECT 1 FROM members WHERE user_id = ?', retrying).toArray()).toHaveLength(0)
  })
  expect(await stub.join(retrying, secret)).toMatchObject({ status: 'pending' })
  await stub.decideJoin(owner, retrying, 'approve')
  expect((await stub.detail(retrying)).id).toBe(id)
  await stub.flushSync()
  expect(await env.DB.prepare('SELECT cache_id FROM my_caches WHERE user_id = ?').bind(retrying).first('cache_id')).toBe(id)
  const rejected = await env.DB.prepare("SELECT payload FROM outbox WHERE kind = 'join_rejected'").all<{ payload: string }>()
  expect(rejected.results.some(row => JSON.parse(row.payload).recipient_id === retrying)).toBe(true)
})

it('thrown joins and decisions roll back membership and all notification/discovery intents', async () => {
  const { stub, owner, applicant, secret } = await created(true)
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec("CREATE TRIGGER fail_notification BEFORE INSERT ON pending_sync WHEN NEW.kind = 'notification' BEGIN SELECT RAISE(ABORT, 'injected notification failure'); END")
  })
  await failure(stub.join(applicant, secret), 'injected notification failure')
  expect(await stub.joinRequests(owner)).toEqual([])
  expect(await intents(stub)).toHaveLength(2)
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('DROP TRIGGER fail_notification') })
  await stub.join(applicant, secret)
  const before = await intents(stub)
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec("CREATE TRIGGER fail_discovery BEFORE INSERT ON pending_sync WHEN NEW.kind = 'discovery_upsert' BEGIN SELECT RAISE(ABORT, 'injected discovery failure'); END")
  })
  await failure(stub.decideJoin(owner, applicant, 'approve'), 'injected discovery failure')
  expect(await intents(stub)).toEqual(before)
  expect(await stub.joinRequests(owner)).toHaveLength(1)
  await stub.update(owner, { requires_approval: false })
  const openApplicant = await user()
  await failure(stub.join(openApplicant, secret), 'injected discovery failure')
  await failure(stub.detail(openApplicant), 'not_found')
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec("CREATE TRIGGER fail_reject BEFORE DELETE ON members BEGIN SELECT RAISE(ABORT, 'injected rejection failure'); END")
  })
  await failure(stub.decideJoin(owner, applicant, 'reject'), 'injected rejection failure')
  expect(await intents(stub)).toEqual(before)
  expect(await stub.joinRequests(owner)).toHaveLength(1)
})

it('notification crash replay preserves one stable outbox row and its existing delivery state', async () => {
  const { id, stub, owner, applicant, secret } = await created(true)
  await stub.join(applicant, secret)
  await stub.decideJoin(owner, applicant, 'reject')
  await stub.join(applicant, secret)
  await stub.decideJoin(owner, applicant, 'approve')
  const notifications = (await intents(stub)).filter(row => row.kind === 'notification')
  expect(notifications).toHaveLength(4)
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON pending_sync WHEN OLD.kind = 'notification' BEGIN SELECT RAISE(ABORT, 'injected outbox crash'); END")
  })
  await failure(stub.flushSync(), 'injected outbox crash')
  expect(await env.DB.prepare('SELECT id FROM outbox').first('id')).toBe(notifications[0].id)
  await env.DB.prepare('UPDATE outbox SET attempts = 4, sent_at = 123, claim_token = ?, claim_until = 456 WHERE id = ?').bind('existing-claim', notifications[0].id).run()
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('DROP TRIGGER fail_delete') })
  await abortAllDurableObjects()
  const restarted = cache(id).stub
  await Promise.all([restarted.flushSync(), restarted.flushSync()])
  await restarted.flushSync()
  expect(await intents(restarted)).toEqual([])
  const rows = await env.DB.prepare('SELECT id, kind, payload, attempts, sent_at, claim_token, claim_until FROM outbox').all<{ id: string; kind: string; payload: string; attempts: number; sent_at: number | null; claim_token: string | null; claim_until: number | null }>()
  expect(rows.results.map(row => row.id).sort()).toEqual(notifications.map(row => row.id).sort())
  expect(rows.results.find(row => row.id === notifications[0].id)).toMatchObject({ attempts: 4, sent_at: 123, claim_token: 'existing-claim', claim_until: 456 })
  expect(rows.results.filter(row => row.kind !== 'join_requested').every(row => JSON.parse(row.payload).recipient_id === applicant)).toBe(true)
})

it('notification D1 failure retains and re-arms work until an alarm successfully fills the outbox', async () => {
  const { stub, applicant, secret } = await created(true)
  await stub.join(applicant, secret)
  await env.DB.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'injected outbox failure'); END")
  expect(await runDurableObjectAlarm(stub)).toBe(true)
  expect((await intents(stub)).map(row => row.kind)).toEqual(['notification'])
  await runInDurableObject(stub, async (_instance, state) => {
    expect(await state.storage.getAlarm()).not.toBeNull()
    await state.storage.deleteAlarm()
  })
  await failure(stub.joinRequests(applicant), 'not_found')
  await runInDurableObject(stub, async (_instance, state) => { expect(await state.storage.getAlarm()).not.toBeNull() })
  await env.DB.exec('DROP TRIGGER fail_outbox')
  expect(await runDurableObjectAlarm(stub)).toBe(true)
  expect(await intents(stub)).toEqual([])
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first('n')).toBe(1)
})

it('Worker resumes a body-only invite after code/name onboarding and protects queue/decisions with CSRF and live D1 authority', async () => {
  const owner = await login('owner@example.test')
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: owner.cookie, body: { display_name: 'Owner' } }), env)
  const response = await worker.fetch(appRequest('/api/caches', { method: 'POST', cookie: owner.cookie, body: { name: 'Tools', requires_approval: true } }), env)
  const info = await response.json() as { id: string; invite_token: string }
  const secret = info.invite_token.split('.')[1]
  const applicant = await login('applicant@example.test')
  const path = `/api/caches/${info.id}`
  const post = (route: string, cookie = applicant.cookie, body: unknown = {}) => worker.fetch(appRequest(route, { method: 'POST', cookie, body }), env)
  expect((await post(path + '/join', undefined, { secret })).status).toBe(409)
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: applicant.cookie, body: { display_name: 'Neighbor' } }), env)
  expect((await worker.fetch(appRequest(path + '/join', { method: 'POST', body: { secret } }), env)).status).toBe(401)
  expect((await post(path + '/join', undefined, {})).status).toBe(400)
  expect((await post(path + '/join', undefined, { secret: 123 })).status).toBe(400)
  expect((await post(path + '/join', undefined, { secret: 'wrong' })).status).toBe(404)
  const decision = `${path}/join-requests/${applicant.id}/approve`
  for (const route of [path + '/join', decision, decision.replace('/approve', '/reject')]) {
    for (const origin of [null, 'null', 'https://foreign.test']) {
      expect((await worker.fetch(appRequest(route, { method: 'POST', cookie: owner.cookie, origin, body: { secret } }), env)).status).toBe(403)
    }
  }
  expect(await (await post(path + '/join', undefined, { secret, user_id: 'forged' })).json()).toEqual({ cache_id: info.id, name: 'Tools', status: 'pending' })
  expect((await worker.fetch(appRequest(path, { cookie: applicant.cookie }), env)).status).toBe(404)
  expect((await worker.fetch(appRequest(path + '/join-requests', { cookie: applicant.cookie }), env)).status).toBe(404)
  expect((await post(decision)).status).toBe(404)
  const queue = await worker.fetch(appRequest(path + '/join-requests', { cookie: owner.cookie }), env)
  expect(await queue.json()).toEqual([{ user_id: applicant.id, display_name: 'Neighbor', created_at: expect.any(Number) }])
  expect((await post(`/api/caches/${crypto.randomUUID()}/join-requests/${applicant.id}/approve`, owner.cookie)).status).toBe(404)
  expect((await post(decision, owner.cookie)).status).toBe(200)
  expect((await post(decision.replace('/approve', '/reject'), owner.cookie)).status).toBe(409)
  const detail = await worker.fetch(appRequest(path, { cookie: applicant.cookie }), env)
  expect(detail.status).toBe(200)
  expect(JSON.stringify(await detail.json())).not.toContain('example.test')
  await env.DB.prepare("UPDATE memberships SET status='removed' WHERE cache_id=? AND user_id=?").bind(info.id,applicant.id).run()
  expect((await post(path + '/join', undefined, { secret })).status).toBe(403)
  expect((await worker.fetch(appRequest(path, { cookie: applicant.cookie }), env)).status).toBe(404)
  expect((await post(path + '/join/' + secret)).status).toBe(404)
})
