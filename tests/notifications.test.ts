import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { createExecutionContext, createMessageBatch, createScheduledController, evictDurableObject, getQueueResult, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import worker from '../src/index'
import { claimOutbox, createCache, decideCacheJoin, joinCache, markOutboxSent, recordOutboxFailure } from '../src/db'
import { deliverNotification, notificationContent, sweepNotifications } from '../src/notifications'
import { appRequest, login } from './helpers'

async function user(name = 'Neighbor') {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?, ?, ?, 1, ?, ?, ?)')
    .bind(id, '', `${id}@example.test`, new Date().toISOString(), new Date().toISOString(), name).run()
  return id
}
async function outbox(options: { id?: string; attempts?: number; kind?: string; payload?: Record<string, unknown>; createdAt?: number } = {}) {
  const recipient = await user(), id = options.id ?? crypto.randomUUID(), kind = options.kind ?? 'request_created'
  const payload = { event: kind, recipient_id: recipient, user_id: crypto.randomUUID(), cache_id: crypto.randomUUID(), cache_name: 'Pantry', item_id: crypto.randomUUID(), item_title: 'Sugar', quantity: 2, ...options.payload }
  await env.DB.prepare('INSERT INTO outbox(id,kind,dedupe_key,payload,attempts,created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, kind, id, JSON.stringify(payload), options.attempts ?? 0, options.createdAt ?? Date.now() - 240_000).run()
  return { id, recipient, kind, payload }
}
function emailMock(status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    expect(input).toBe('https://api.resend.com/emails')
    expect(options?.redirect).toBe('manual')
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    return Response.json({ id: 'fixture-email' }, { status })
  })
}
async function consume(ids: unknown[]) {
  const batch = createMessageBatch('test-notifications', ids.map(body => ({ id: crypto.randomUUID(), timestamp: new Date(), attempts: 1, body })))
  await worker.queue(batch, env)
  return { batch, result: await getQueueResult(batch, createExecutionContext()) }
}
async function row(id: string) {
  return env.DB.prepare('SELECT attempts,claim_token,claim_until,sent_at,failed_at FROM outbox WHERE id = ?').bind(id)
    .first<{ attempts: number; claim_token: string | null; claim_until: number | null; sent_at: number | null; failed_at: number | null }>()
}
async function failure(call: PromiseLike<unknown>, message: string) {
  let error: unknown
  try { await call } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain(message)
}

it('competing consumers acquire one guarded claim and only one sends; duplicate, missing and invalid Queue IDs ack safely', async () => {
  const event = await outbox(), mail = emailMock()
  const results = await Promise.all([consume([event.id]), consume([event.id])])
  expect(mail).toHaveBeenCalledTimes(1)
  expect(results.every(value => value.result.explicitAcks.length === 1)).toBe(true)
  expect(await row(event.id)).toMatchObject({ attempts: 1, sent_at: expect.any(Number), failed_at: null, claim_token: null })
  const replay = await consume([event.id, crypto.randomUUID(), { id: event.id }, 'invalid'])
  expect(replay.result.explicitAcks).toHaveLength(4)
  expect(mail).toHaveBeenCalledTimes(1)
})

it('records six observed failures as terminal but never treats attempts alone as an eligibility cutoff', async () => {
  const event = await outbox(), mail = emailMock(503)
  for (let attempt = 1; attempt <= 6; attempt++) {
    const { result } = await consume([event.id])
    const stored = await row(event.id)
    expect(stored).toMatchObject({ attempts: attempt, sent_at: null, claim_token: null, claim_until: null })
    if (attempt < 6) { expect(stored?.failed_at).toBeNull(); expect(result.retryMessages).toHaveLength(1) }
    else { expect(stored?.failed_at).not.toBeNull(); expect(result.explicitAcks).toHaveLength(1) }
  }
  await consume([event.id])
  expect(mail).toHaveBeenCalledTimes(6)
  const crashedManyTimes = await outbox({ attempts: 40 })
  mail.mockImplementation(async () => Response.json({ id: 'delivered' }))
  expect(await deliverNotification(env, crashedManyTimes.id)).toBe('ack')
  expect(await row(crashedManyTimes.id)).toMatchObject({ attempts: 41, sent_at: expect.any(Number), failed_at: null })
})

it('Cron re-enqueues an expired crashed sixth claim and a seventh claim can still deliver', async () => {
  const event = await outbox({ attempts: 5 }), now = Date.now()
  expect((await claimOutbox(env.DB, event.id, 'crashed-claim', now))?.attempts).toBe(6)
  const send = env.NOTIFICATIONS.sendBatch.bind(env.NOTIFICATIONS)
  const queued = vi.spyOn(env.NOTIFICATIONS, 'sendBatch').mockImplementation(messages => send(messages))
  await sweepNotifications(env)
  expect(queued).not.toHaveBeenCalled()
  await env.DB.prepare('UPDATE outbox SET claim_until = ? WHERE id = ?').bind(now - 1, event.id).run()
  await worker.scheduled(createScheduledController(), env)
  expect(queued).toHaveBeenCalledWith([{ body: event.id }])
  const mail = emailMock()
  await consume([event.id])
  expect(mail).toHaveBeenCalledOnce()
  expect(await row(event.id)).toMatchObject({ attempts: 7, sent_at: expect.any(Number), failed_at: null })
})

it('mixed crashes and observed failures only stamp failed_at when a failure is actually observed after the budget', async () => {
  const event = await outbox({ attempts: 4 }), now = Date.now()
  const mail = emailMock(500)
  expect(await deliverNotification(env, event.id)).toBe('retry')
  expect(await row(event.id)).toMatchObject({ attempts: 5, failed_at: null })
  expect((await claimOutbox(env.DB, event.id, 'sixth-crash', now))?.attempts).toBe(6)
  expect(await row(event.id)).toMatchObject({ attempts: 6, failed_at: null })
  await env.DB.prepare('UPDATE outbox SET claim_until = ? WHERE id = ?').bind(now - 1, event.id).run()
  expect(await deliverNotification(env, event.id)).toBe('ack')
  expect(await row(event.id)).toMatchObject({ attempts: 7, sent_at: null, failed_at: expect.any(Number) })
  expect(mail).toHaveBeenCalledTimes(2)
})

it('guards both terminal writes by sent/failed state, current token and an unexpired lease', async () => {
  const event = await outbox(), now = Date.now()
  expect(await claimOutbox(env.DB, event.id, 'old', now)).not.toBeNull()
  expect(await claimOutbox(env.DB, event.id, 'early', now + 1)).toBeNull()
  expect((await markOutboxSent(env.DB, event.id, 'old', now + 90_001)).meta.changes).toBe(0)
  expect((await recordOutboxFailure(env.DB, event.id, 'old', now + 90_001, true)).meta.changes).toBe(0)
  expect(await claimOutbox(env.DB, event.id, 'new', now + 90_002)).not.toBeNull()
  expect((await markOutboxSent(env.DB, event.id, 'old', now + 90_003)).meta.changes).toBe(0)
  expect((await recordOutboxFailure(env.DB, event.id, 'old', now + 90_003, true)).meta.changes).toBe(0)
  expect((await markOutboxSent(env.DB, event.id, 'new', now + 90_003)).meta.changes).toBe(1)
  expect((await recordOutboxFailure(env.DB, event.id, 'new', now + 90_004, true)).meta.changes).toBe(0)
  const failed = await outbox()
  await claimOutbox(env.DB, failed.id, 'failed', now)
  expect((await recordOutboxFailure(env.DB, failed.id, 'failed', now + 1, true)).meta.changes).toBe(1)
  expect((await markOutboxSent(env.DB, failed.id, 'failed', now + 2)).meta.changes).toBe(0)
  expect(await claimOutbox(env.DB, failed.id, 'again', now + 100_000)).toBeNull()
})

it('does not let a late consumer stamp success or failure over a newer successful claimant', async () => {
  for (const lateStatus of [200, 503]) {
    const event = await outbox({ attempts: 5 })
    let started!: () => void, finish!: (response: Response) => void, calls = 0
    const began = new Promise<void>(resolve => { started = resolve })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (++calls > 1) return Response.json({ id: 'new send' })
      started()
      return new Promise<Response>(resolve => { finish = resolve })
    })
    const old = consume([event.id])
    await began
    await env.DB.prepare('UPDATE outbox SET claim_until=? WHERE id=?').bind(Date.now() - 1, event.id).run()
    const newer = await consume([event.id])
    expect(newer.result.explicitAcks).toHaveLength(1)
    finish(Response.json({ id: 'late send' }, { status: lateStatus }))
    expect((await old).result.retryMessages).toHaveLength(1)
    expect(await row(event.id)).toMatchObject({ attempts: 7, sent_at: expect.any(Number), failed_at: null, claim_token: null })
  }
})

it('retries an accepted email whose durable success write failed, allowing at-least-once duplication after lease recovery', async () => {
  const event = await outbox(), mail = emailMock()
  await env.DB.exec("CREATE TRIGGER fail_success BEFORE UPDATE ON outbox WHEN NEW.sent_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'injected terminal crash'); END")
  const first = await consume([event.id])
  expect(first.result.retryMessages).toHaveLength(1)
  expect(first.result.explicitAcks).toEqual([])
  expect(await row(event.id)).toMatchObject({ sent_at: null, failed_at: null, attempts: 1 })
  await env.DB.exec('DROP TRIGGER fail_success')
  await env.DB.prepare('UPDATE outbox SET claim_until = ? WHERE id = ?').bind(Date.now() - 1, event.id).run()
  await consume([event.id])
  expect(mail).toHaveBeenCalledTimes(2)
  expect(await row(event.id)).toMatchObject({ sent_at: expect.any(Number), failed_at: null, attempts: 2 })
})

it('persists intent→D1→real Queue in order and replays both Queue-send and post-send deletion crashes with stable IDs', async () => {
  const owner = await user(), applicant = await user(), cacheId = crypto.randomUUID()
  const stub = env.CACHES.get(env.CACHES.idFromName(cacheId))
  const cache = await stub.create(cacheId, owner, 'Pantry', true)
  await stub.join(applicant, cache.invite_token.split('.')[1])
  const intent = await runInDurableObject(stub, (_instance, state) => state.storage.sql.exec<{ id: string }>("SELECT id FROM pending_sync WHERE kind='notification'").one().id)
  expect(await row(intent)).toBeNull()
  const send = vi.spyOn(env.NOTIFICATIONS, 'send').mockRejectedValue(new Error('injected Queue failure'))
  await failure(stub.flushSync(), 'injected Queue failure')
  expect(await row(intent)).toMatchObject({ attempts: 0, sent_at: null, failed_at: null })
  await runInDurableObject(stub, (_instance, state) => { expect(state.storage.sql.exec('SELECT id FROM pending_sync').one().id).toBe(intent) })
  send.mockRestore()
  const original = env.NOTIFICATIONS.send.bind(env.NOTIFICATIONS)
  const replayed = vi.spyOn(env.NOTIFICATIONS, 'send').mockImplementation((body, options) => original(body, options))
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON pending_sync WHEN OLD.kind='notification' BEGIN SELECT RAISE(ABORT, 'injected post-Queue crash'); END") })
  await failure(stub.flushSync(), 'injected post-Queue crash')
  await runInDurableObject(stub, (_instance, state) => { state.storage.sql.exec('DROP TRIGGER fail_delete') })
  await stub.flushSync()
  expect(replayed.mock.calls.map(call => call[0])).toEqual([intent, intent])
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM outbox WHERE id=?').bind(intent).first('n')).toBe(1)
  const mail = emailMock()
  await consume([intent, intent])
  expect(mail).toHaveBeenCalledOnce()
})

it('cursor-pages old expired nonterminal work, excludes live claims/terminal/recent rows and retains the cursor when Queue send fails', async () => {
  const ids = Array.from({ length: 27 }, () => crypto.randomUUID()).sort()
  for (const id of ids) await outbox({ id, attempts: 100 })
  const recent = await outbox({ createdAt: Date.now() }), sent = await outbox(), failed = await outbox(), live = await outbox()
  await env.DB.prepare('UPDATE outbox SET sent_at=? WHERE id=?').bind(Date.now(), sent.id).run()
  await env.DB.prepare('UPDATE outbox SET failed_at=? WHERE id=?').bind(Date.now(), failed.id).run()
  await claimOutbox(env.DB, live.id, 'live', Date.now())
  const send = env.NOTIFICATIONS.sendBatch.bind(env.NOTIFICATIONS)
  const queued = vi.spyOn(env.NOTIFICATIONS, 'sendBatch').mockImplementation(messages => send(messages))
  await sweepNotifications(env)
  expect(Array.from(queued.mock.calls[0][0], message => message.body)).toEqual(ids.slice(0, 25))
  expect(await env.DB.prepare('SELECT outbox_id FROM notification_sync_cursor').first('outbox_id')).toBe(ids[24])
  queued.mockRejectedValueOnce(new Error('injected recovery Queue failure'))
  await expect(sweepNotifications(env)).rejects.toThrow('injected recovery Queue failure')
  expect(await env.DB.prepare('SELECT outbox_id FROM notification_sync_cursor').first('outbox_id')).toBe(ids[24])
  await sweepNotifications(env)
  expect(Array.from(queued.mock.calls[2][0], message => message.body)).toEqual(ids.slice(25))
  expect(await env.DB.prepare('SELECT outbox_id FROM notification_sync_cursor').first('outbox_id')).toBeNull()
  expect(queued.mock.calls.flatMap(call => Array.from(call[0], message => message.body))).not.toContain(recent.id)
})

it('escapes user content, derives same-origin links rather than trusting payload paths and privately looks up only the recipient email', async () => {
  const event = await outbox({ kind: 'request_rejected', payload: { cache_name: '<Pantry & neighbors>', item_title: '<img src=x onerror=alert(1)>', reason: '"No" & <not today>', path: 'https://evil.test/steal' } })
  const mail = emailMock()
  await consume([event.id])
  const body = JSON.parse(mail.mock.calls[0][1]!.body as string) as { from: string; to: string[]; html: string; text: string; subject: string }
  expect(body.from).toBe(env.EMAIL_FROM)
  expect(body.to).toEqual([`${event.recipient}@example.test`])
  expect(body.subject).not.toContain('sign-in')
  expect(body.html).toContain('&lt;Pantry &amp; neighbors&gt;')
  expect(body.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  expect(body.html).toContain('&quot;No&quot; &amp; &lt;not today&gt;')
  expect(body.html).not.toContain('<img')
  expect(body.html).not.toContain('evil.test')
  expect(body.text).toContain('<not today>')
  expect(body.html).toContain(`https://communalcache.com/caches/${event.payload.cache_id}/items/${event.payload.item_id}`)
  for (const kind of ['join_requested', 'join_approved', 'join_rejected', 'request_created', 'request_approved', 'item_deleted', 'member_removed']) {
    expect(notificationContent({ id: event.id, kind, attempts: 1, payload: JSON.stringify({ ...event.payload, event: kind }) }, env.APP_BASE_URL).subject).toBeTruthy()
  }
})

it('bounds consumer batches to three sequential delivery rows and rejects malformed payloads without sending', async () => {
  const ids: string[] = []
  for (let count = 0; count < 6; count++) ids.push((await outbox()).id)
  const mail = emailMock()
  const batch = await consume(ids)
  expect(mail).toHaveBeenCalledTimes(3)
  expect(batch.result.explicitAcks).toHaveLength(3)
  expect(batch.result.retryMessages).toHaveLength(3)
  const invalid = await outbox({ attempts: 5, payload: { event: 'unknown' } })
  await consume([invalid.id])
  expect(await row(invalid.id)).toMatchObject({ attempts: 6, failed_at: expect.any(Number), sent_at: null })
  expect(mail).toHaveBeenCalledTimes(3)
})

it('enforces both the 10-second provider abort and the 30-second whole-delivery abort including a stuck response body', async () => {
  const timers = new Map<number, AbortController>()
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => { const controller = new AbortController(); timers.set(milliseconds, controller); return controller.signal })
  const event = await outbox()
  let started!: () => void
  const fetching = new Promise<void>(resolve => { started = resolve })
  const mail = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, options) => {
    started()
    return new Promise<Response>((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true }))
  })
  const first = deliverNotification(env, event.id)
  await fetching
  expect([...timers.keys()].sort((left, right) => left - right)).toEqual([10_000, 30_000])
  timers.get(10_000)!.abort(new DOMException('Provider deadline', 'TimeoutError'))
  expect(await first).toBe('retry')
  expect(await row(event.id)).toMatchObject({ attempts: 1, failed_at: null, claim_token: null })
  let cancelling!: () => void, finishCancel!: () => void
  const bodyStarted = new Promise<void>(resolve => { cancelling = resolve })
  mail.mockImplementation(async () => new Response(new ReadableStream({ cancel() { cancelling(); return new Promise<void>(resolve => { finishCancel = resolve }) } })))
  const second = deliverNotification(env, event.id)
  await bodyStarted
  timers.get(30_000)!.abort(new DOMException('Row deadline', 'TimeoutError'))
  expect(await second).toBe('retry')
  finishCancel()
  expect(await row(event.id)).toMatchObject({ attempts: 2, failed_at: null, claim_token: null })
})

it('persists exponential sync backoff through eviction and entry points, lets Cron respect it, and resumes after recovery', async () => {
  const owner = await user(), cacheId = crypto.randomUUID(), stub = env.CACHES.get(env.CACHES.idFromName(cacheId))
  await stub.create(cacheId, owner, 'Pantry', false)
  await stub.flushSync()
  await stub.update(owner, { name: 'New pantry' })
  await env.DB.exec("CREATE TRIGGER fail_registry BEFORE INSERT ON caches BEGIN SELECT RAISE(ABORT, 'injected persistent sync failure'); END")
  for (let failureCount = 0; failureCount < 11; failureCount++) expect(await runDurableObjectAlarm(stub)).toBe(true)
  const retry = await runInDurableObject(stub, async (_instance, state) => {
    const value = await state.storage.get<{ failures: number; retryAt: number }>('sync_retry')
    expect(value?.failures).toBe(11)
    expect((await state.storage.getAlarm())! - Date.now()).toBeGreaterThan(3_590_000)
    return value!
  })
  await evictDurableObject(stub)
  await stub.detail(owner)
  await worker.scheduled(createScheduledController(), env)
  await runInDurableObject(stub, async (_instance, state) => { expect(await state.storage.get('sync_retry')).toEqual(retry); expect((await state.storage.getAlarm())!).toBeGreaterThanOrEqual(retry.retryAt) })
  await env.DB.exec('DROP TRIGGER fail_registry')
  await stub.flushSync()
  await runInDurableObject(stub, async (_instance, state) => { expect(await state.storage.get('sync_retry')).toBeUndefined() })
  expect(await env.DB.prepare('SELECT name FROM caches WHERE id=?').bind(cacheId).first('name')).toBe('New pantry')
})

it('rejects unavailable recipients and provider redirects as observed failures without following them', async () => {
  const event = await outbox(), mail = emailMock(302)
  await env.DB.prepare('UPDATE user SET emailVerified=0 WHERE id=?').bind(event.recipient).run()
  expect(await deliverNotification(env, event.id)).toBe('retry')
  expect(mail).not.toHaveBeenCalled()
  await env.DB.prepare('UPDATE user SET emailVerified=1 WHERE id=?').bind(event.recipient).run()
  expect(await deliverNotification(env, event.id)).toBe('retry')
  expect(mail.mock.calls[0][1]?.redirect).toBe('manual')
  mail.mockImplementation(async () => Response.json({ id: 'delivered' }))
  expect(await deliverNotification(env, event.id)).toBe('ack')
  expect(await row(event.id)).toMatchObject({ attempts: 3, sent_at: expect.any(Number), failed_at: null })
})

it('runs notification recovery even when the registry recovery cursor fails', async () => {
  const event = await outbox()
  const send = env.NOTIFICATIONS.sendBatch.bind(env.NOTIFICATIONS)
  const queued = vi.spyOn(env.NOTIFICATIONS, 'sendBatch').mockImplementation(messages => send(messages))
  await env.DB.exec("CREATE TRIGGER fail_cursor BEFORE UPDATE ON cache_sync_cursor BEGIN SELECT RAISE(ABORT, 'injected registry cursor failure'); END")
  await expect(worker.scheduled(createScheduledController(), env)).rejects.toThrow('Scheduled recovery incomplete')
  expect(queued).toHaveBeenCalledWith([{ body: event.id }])
})

it('keeps recipient emails off app APIs while delivering through private auth-row lookup', async () => {
  const owner = await login('owner@example.test'), recipient = await user('Private neighbor')
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: owner.cookie, body: { display_name: 'Owner' } }), env)
  const info = await createCache(env.DB, owner.id, 'Pantry', true), cacheId = info.id
  await joinCache(env.DB, cacheId, recipient, info.invite_token.split('.')[1])
  const decision = await decideCacheJoin(env.DB, cacheId, owner.id, recipient, 'approve')
  for (const path of [`/api/caches/${cacheId}`, `/api/caches/${cacheId}/join-requests`, '/api/caches']) {
    const response = await worker.fetch(appRequest(path, { cookie: owner.cookie }), env)
    expect(response.status).toBe(200)
    expect(JSON.stringify(await response.json())).not.toContain('example.test')
  }
  for (const path of [`/api/caches/${cacheId}/items/${crypto.randomUUID()}/requests`, '/api/requests']) {
    const response = await worker.fetch(appRequest(path, { cookie: owner.cookie }), env)
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('example.test')
  }
  const mail = emailMock()
  mail.mockClear()
  expect(await deliverNotification(env, decision.notificationId)).toBe('ack')
  expect(JSON.parse(mail.mock.calls[0][1]!.body as string).to).toEqual([`${recipient}@example.test`])
  expect(await (await worker.fetch(appRequest('/api/me', { cookie: owner.cookie }), env)).json()).toMatchObject({ email: 'owner@example.test' })
  expect((await worker.fetch(appRequest('/api/notifications', { cookie: owner.cookie }), env)).status).toBe(404)
})
