import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { deletePush, pushSubscriptions, savePush } from '../src/db'
import { deliverNotification } from '../src/notifications'
import { pushEndpoint, pushSubscription, sendPush } from '../src/push'
import { appRequest, login } from './helpers'

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
async function subscription(endpoint = 'https://fcm.googleapis.com/push/browser') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  return { endpoint, keys: { p256dh: encode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer)), auth: encode(crypto.getRandomValues(new Uint8Array(16))) } }
}
async function user() {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?, ?, ?, 1, ?, ?, ?)')
    .bind(id, '', `${id}@example.test`, new Date().toISOString(), new Date().toISOString(), 'Neighbor').run()
  return id
}
async function event() {
  const recipient = await user(), id = crypto.randomUUID()
  const payload = { event: 'request_created', recipient_id: recipient, cache_id: crypto.randomUUID(), cache_name: 'Pantry', item_id: crypto.randomUUID(), item_title: 'Sugar', quantity: 2 }
  await env.DB.prepare('INSERT INTO outbox(id,kind,dedupe_key,payload,created_at) VALUES (?,?,?,?,?)').bind(id, payload.event, id, JSON.stringify(payload), Date.now()).run()
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey) as JsonWebKey
  return { id, recipient, pushEnv: { ...env, VAPID_PUBLIC_KEY: encode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer)), VAPID_PRIVATE_KEY: jwk.d! } }
}
async function register(userId: string, endpoint?: string) {
  const input = await subscription(endpoint)
  await savePush(env.DB, userId, await pushSubscription(input))
  return input
}
async function outboxState(id: string) {
  return env.DB.prepare('SELECT attempts,sent_at,failed_at,claim_token FROM outbox WHERE id=?').bind(id).first<{ attempts: number; sent_at: number | null; failed_at: number | null; claim_token: string | null }>()
}

it('allows only exact HTTPS push services and Windows hostname-boundary subdomains with standard ports and no userinfo', () => {
  for (const url of ['https://fcm.googleapis.com/token', 'https://updates.push.services.mozilla.com/token', 'https://web.push.apple.com/token', 'https://wns.notify.windows.com/token', 'https://a.b.notify.windows.com/token']) expect(pushEndpoint(url)).toBe(url)
  expect(pushEndpoint('https://fcm.googleapis.com:443/token')).toBe('https://fcm.googleapis.com/token')
  for (const url of ['http://fcm.googleapis.com/token', 'https://user:pass@fcm.googleapis.com/token', 'https://fcm.googleapis.com:444/token', 'https://fcm.googleapis.com.evil.test/token', 'https://evilnotify.windows.com/token', 'https://notify.windows.com/token', 'https://notify.windows.com.evil.test/token', 'https://127.0.0.1/token', 'https://[::1]/token', 'https://169.254.169.254/token', 'https://metadata.google.internal/token', 'https://localhost/token', 'https://example.test/token', 'https://fcm.googleapis.com/token#fragment', ' https://fcm.googleapis.com/token', 'not a URL']) expect(() => pushEndpoint(url)).toThrow('invalid_push_endpoint')
})

it('validates canonical 16-byte auth and uncompressed on-curve P-256 subscription keys', async () => {
  const input = await subscription()
  expect(await pushSubscription(input)).toEqual({ endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth })
  for (const keys of [null, {}, { ...input.keys, auth: '' }, { ...input.keys, auth: input.keys.auth + '=' }, { ...input.keys, auth: encode(new Uint8Array(15)) }, { ...input.keys, p256dh: encode(new Uint8Array(65)) }, { ...input.keys, p256dh: encode(new Uint8Array([4, ...new Uint8Array(64)])) }]) await expect(pushSubscription({ endpoint: input.endpoint, keys })).rejects.toThrow('invalid_push_keys')
})

it('stores caller-only subscriptions without profile gating, reassigns shared browser endpoints and scopes unsubscribe', async () => {
  const first = await login('first@example.test'), input = await subscription()
  const post = (cookie: string, body: unknown = input) => worker.fetch(appRequest('/api/push/subscribe', { method: 'POST', cookie, body }), env)
  const response = await post(first.cookie, { ...input, user_id: 'forged' })
  expect(response.status).toBe(204)
  const original = (await pushSubscriptions(env.DB, first.id)).results[0]
  expect(original.user_id).toBe(first.id)
  const second = await login('second@example.test')
  expect((await post(second.cookie)).status).toBe(204)
  expect((await pushSubscriptions(env.DB, first.id)).results).toEqual([])
  const reassigned = (await pushSubscriptions(env.DB, second.id)).results[0]
  expect(reassigned.id).not.toBe(original.id)
  expect(reassigned.endpoint).toBe(input.endpoint)
  const remove = (cookie: string) => worker.fetch(appRequest('/api/push/subscribe', { method: 'DELETE', cookie, body: { endpoint: input.endpoint } }), env)
  expect((await remove(first.cookie)).status).toBe(204)
  expect((await pushSubscriptions(env.DB, second.id)).results).toHaveLength(1)
  expect((await remove(second.cookie)).status).toBe(204)
  expect((await pushSubscriptions(env.DB, second.id)).results).toEqual([])
  expect((await worker.fetch(appRequest('/api/push/subscribe', { cookie: second.cookie }), env)).status).toBe(405)
})

it('requires cookies and exact mutation Origin, and returns field errors for unsupported endpoints or keys', async () => {
  const caller = await login(), input = await subscription()
  expect((await worker.fetch(appRequest('/api/push/subscribe', { method: 'POST', body: input }), env)).status).toBe(401)
  for (const method of ['POST', 'DELETE']) for (const origin of [null, 'null', 'https://foreign.test']) expect((await worker.fetch(appRequest('/api/push/subscribe', { method, cookie: caller.cookie, origin, body: input }), env)).status).toBe(403)
  for (const body of [{ ...input, endpoint: 'https://evil.test/path' }, { ...input, keys: {} }]) expect((await worker.fetch(appRequest('/api/push/subscribe', { method: 'POST', cookie: caller.cookie, body }), env)).status).toBe(400)
})

it('atomically caps registrations at three browsers while permitting a refresh of an existing endpoint', async () => {
  const caller = await login(), input = await subscription()
  const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => worker.fetch(appRequest('/api/push/subscribe', { method: 'POST', cookie: caller.cookie, body: { ...input, endpoint: input.endpoint + index } }), env)))
  expect(responses.filter(response => response.status === 204)).toHaveLength(3)
  expect(responses.filter(response => response.status === 409)).toHaveLength(3)
  const current = (await pushSubscriptions(env.DB, caller.id)).results
  expect(current).toHaveLength(3)
  expect((await worker.fetch(appRequest('/api/push/subscribe', { method: 'POST', cookie: caller.cookie, body: { ...input, endpoint: current[0].endpoint } }), env)).status).toBe(204)
})

it('delivers encrypted push through the guarded outbox without email when a subscription is live', async () => {
  const { id, recipient, pushEnv } = await event(), input = await register(recipient)
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    expect(url).toBe(input.endpoint)
    expect(options?.redirect).toBe('manual')
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    expect(options?.headers).toMatchObject({ 'content-encoding': 'aes128gcm', authorization: expect.stringMatching(/^vapid t=/) })
    expect((options?.body as Uint8Array).byteLength).toBe(4096)
    return new Response(null, { status: 201 })
  })
  expect(await deliverNotification(pushEnv, id)).toBe('ack')
  expect(await outboxState(id)).toMatchObject({ attempts: 1, sent_at: expect.any(Number), failed_at: null, claim_token: null })
  expect(await deliverNotification(pushEnv, id)).toBe('ack')
  expect(fetchMock).toHaveBeenCalledOnce()
})

it('uses email when there are no subscriptions, or all return 404/410 in that same pass', async () => {
  for (const expired of [false, true]) {
    const { id, recipient, pushEnv } = await event()
    if (expired) { await register(recipient, 'https://web.push.apple.com/gone'); await register(recipient, 'https://fcm.googleapis.com/missing') }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      expect(options?.redirect).toBe('manual')
      if (url === 'https://api.resend.com/emails') return Response.json({ id: 'mail' })
      return new Response(null, { status: String(url).endsWith('/gone') ? 410 : 404 })
    })
    fetchMock.mockClear()
    expect(await deliverNotification(pushEnv, id)).toBe('ack')
    expect(fetchMock.mock.calls.filter(call => call[0] === 'https://api.resend.com/emails')).toHaveLength(1)
    expect((await pushSubscriptions(env.DB, recipient)).results).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(expired ? 3 : 1)
  }
})

it('cleans an expired browser but never emails when another browser accepted push', async () => {
  const { id, recipient, pushEnv } = await event()
  await register(recipient, 'https://web.push.apple.com/live')
  await register(recipient, 'https://fcm.googleapis.com/gone')
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => new Response(null, { status: String(url).endsWith('/gone') ? 410 : 201 }))
  expect(await deliverNotification(pushEnv, id)).toBe('ack')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls.some(call => call[0] === 'https://api.resend.com/emails')).toBe(false)
  expect((await pushSubscriptions(env.DB, recipient)).results).toHaveLength(1)
})

it('keeps mixed accepted/expired/transient browsers in push retries without structural email fallback', async () => {
  const { id, recipient, pushEnv } = await event()
  await register(recipient, 'https://web.push.apple.com/live')
  await register(recipient, 'https://fcm.googleapis.com/gone')
  await register(recipient, 'https://updates.push.services.mozilla.com/retry')
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => new Response(null, { status: String(url).endsWith('/gone') ? 410 : String(url).endsWith('/retry') ? 503 : 201 }))
  expect(await deliverNotification(pushEnv, id)).toBe('retry')
  expect(await outboxState(id)).toMatchObject({ attempts: 1, sent_at: null, failed_at: null })
  expect((await pushSubscriptions(env.DB, recipient)).results).toHaveLength(2)
  fetchMock.mockImplementation(async () => new Response(null, { status: 201 }))
  expect(await deliverNotification(pushEnv, id)).toBe('ack')
  expect(fetchMock.mock.calls.every(call => call[0] !== 'https://api.resend.com/emails')).toBe(true)
})

it('applies the whole-row deadline to push and never continues later browsers or email after abort', async () => {
  const { id, recipient, pushEnv } = await event()
  await register(recipient, 'https://web.push.apple.com/one')
  await register(recipient, 'https://fcm.googleapis.com/two')
  const timers = new Map<number, AbortController>()
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => { const controller = new AbortController(); timers.set(milliseconds, controller); return controller.signal })
  let started!: () => void
  const began = new Promise<void>(resolve => { started = resolve })
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    started()
    return new Promise<Response>((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true }))
  })
  const delivering = deliverNotification(pushEnv, id)
  await began
  expect(timers.has(10_000)).toBe(true)
  timers.get(30_000)!.abort(new DOMException('Row timeout', 'TimeoutError'))
  expect(await delivering).toBe('retry')
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(await outboxState(id)).toMatchObject({ attempts: 1, sent_at: null, failed_at: null })
})

it('retries transient push failures without email escalation, even when the final attempt becomes failed_at', async () => {
  const { id, recipient, pushEnv } = await event()
  await register(recipient)
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }))
  for (let attempt = 1; attempt <= 6; attempt++) expect(await deliverNotification(pushEnv, id)).toBe(attempt === 6 ? 'ack' : 'retry')
  expect(await outboxState(id)).toMatchObject({ attempts: 6, sent_at: null, failed_at: expect.any(Number) })
  expect(fetchMock.mock.calls.every(call => call[0] !== 'https://api.resend.com/emails')).toBe(true)
})

it('refuses redirects and revalidates untrusted stored endpoints/keys before any send', async () => {
  const { id, recipient, pushEnv } = await event()
  const input = await register(recipient)
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } }))
  expect(await deliverNotification(pushEnv, id)).toBe('retry')
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual')
  fetchMock.mockClear()
  await env.DB.prepare('UPDATE push_subscriptions SET endpoint=? WHERE user_id=?').bind('https://evil.test/metadata', recipient).run()
  expect(await deliverNotification(pushEnv, id)).toBe('retry')
  expect(fetchMock).not.toHaveBeenCalled()
  await env.DB.prepare('UPDATE push_subscriptions SET endpoint=?,p256dh=? WHERE user_id=?').bind(input.endpoint, 'broken', recipient).run()
  expect(await deliverNotification(pushEnv, id)).toBe('retry')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('does not let an old 410 delete a newer endpoint assignment to another account', async () => {
  const { id, recipient, pushEnv } = await event(), newcomer = await user(), input = await register(recipient)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'mail' })
    await savePush(env.DB, newcomer, await pushSubscription(input))
    return new Response(null, { status: 410 })
  })
  expect(await deliverNotification(pushEnv, id)).toBe('ack')
  expect((await pushSubscriptions(env.DB, newcomer)).results).toHaveLength(1)
  expect((await pushSubscriptions(env.DB, recipient)).results).toEqual([])
})

it('does not send a captured subscription after it has been removed or reassigned before send', async () => {
  const { recipient, pushEnv } = await event(), input = await register(recipient)
  const captured = (await pushSubscriptions(env.DB, recipient)).results[0]
  await deletePush(env.DB, recipient, input.endpoint)
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  expect(await sendPush(pushEnv, captured, { title: 'Notice', body: 'Body', path: '/' }, new AbortController().signal)).toBe('gone')
  expect(fetchMock).not.toHaveBeenCalled()
})
