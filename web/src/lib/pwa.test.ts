/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

function worker(userId: string | null = null, sessionId: string | null = userId) {
  const handlers = new Map<string, (event: unknown) => void>()
  const showNotification = vi.fn(async () => {})
  const focus = vi.fn(async () => {})
  const matchAll = vi.fn(async () => [] as { url: string; focus: () => Promise<void> }[])
  const openWindow = vi.fn(async () => {})
  const self = { location: { origin: 'https://communalcache.com' }, addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler), skipWaiting: vi.fn(async () => {}), registration: { showNotification }, clients: { claim: vi.fn(async () => {}), matchAll, openWindow } }
  const fetch = vi.fn(async () => sessionId ? Response.json({ id: sessionId }) : new Response(null, { status: 401 }))
  const match = vi.fn(async () => userId ? new Response(userId) : undefined)
  const caches = { open: vi.fn(async () => ({ match })) }
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), { self, URL, caches, fetch, AbortSignal })
  async function fire(name: string, data: Record<string, unknown>) {
    let work = Promise.resolve<unknown>(undefined)
    handlers.get(name)!({ ...data, waitUntil: (promise: Promise<unknown>) => { work = promise } })
    await work
  }
  return { handlers, fire, showNotification, focus, matchAll, openWindow, fetch, caches }
}

it('links an installable standalone manifest and never caches authenticated responses', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../public/manifest.webmanifest', import.meta.url), 'utf8'))
  expect(manifest).toMatchObject({ name: 'Communal Cache', start_url: '/', scope: '/', display: 'standalone' })
  expect(manifest.icons).toContainEqual(expect.objectContaining({ src: '/favicon.svg', type: 'image/svg+xml' }))
  for (const size of [192,512]) expect(manifest.icons).toContainEqual(expect.objectContaining({ src: `/icon-${size}.png`, sizes: `${size}x${size}`, purpose: 'any maskable' }))
  expect(readFileSync(new URL('../../public/favicon.svg', import.meta.url), 'utf8')).toContain('<svg')
  expect(readFileSync(new URL('../../index.html', import.meta.url), 'utf8')).toContain('/manifest.webmanifest')
  expect(worker().handlers.has('fetch')).toBe(false)
})

it('shows identifying text only for a matching stored recipient and current authenticated session', async () => {
  const sw = worker('account-A')
  await sw.fire('push', { data: { json: () => ({ recipient_id: 'account-A', title: 'Approved', body: 'Your item request', path: '/requests' }) } })
  expect(sw.showNotification).toHaveBeenCalledWith('Approved', { body: 'Your item request', icon: '/favicon.svg', data: { path: '/requests' } })
  expect(sw.caches.open).toHaveBeenCalledWith('communalcache-push-account')
  expect(sw.fetch).toHaveBeenCalledWith('/api/me', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', signal: expect.any(AbortSignal) }))
})

it.each([
  ['account-B', 'account-B', 'account-A'], [null, null, 'account-A'],
  ['account-A', 'account-B', 'account-A'], ['account-A', null, 'account-A'],
  ['account-A', 'account-A', undefined], ['account-A', 'account-A', ''],
])('uses generic text/path when stored=%s session=%s recipient=%s', async (stored, session, recipient) => {
  const sw = worker(stored, session)
  await sw.fire('push', { data: { json: () => ({ recipient_id: recipient, title: 'Private cache', body: 'Private item and reason', path: '/requests/private' }) } })
  expect(sw.showNotification).toHaveBeenCalledExactlyOnceWith('Communal Cache', { body: 'You have an update in Communal Cache', icon: '/favicon.svg', data: { path: '/' } })
})

it('fails generic for unavailable account storage, offline/error responses and malformed/legacy payloads', async () => {
  const sw = worker('account-A')
  const payload = { data: { json: () => ({ recipient_id: 'account-A', title: 'Private', body: 'Private', path: '/requests' }) } }
  sw.caches.open.mockRejectedValueOnce(new Error('storage unavailable'))
  await sw.fire('push', payload)
  sw.fetch.mockRejectedValueOnce(new Error('offline'))
  await sw.fire('push', payload)
  sw.fetch.mockResolvedValueOnce(new Response('bad JSON'))
  await sw.fire('push', payload)
  await sw.fire('push', { data: { json: () => { throw new Error('bad JSON') } } })
  for (const call of sw.showNotification.mock.calls) expect(call).toEqual(['Communal Cache', { body: 'You have an update in Communal Cache', icon: '/favicon.svg', data: { path: '/' } }])
  expect(sw.showNotification).toHaveBeenCalledTimes(4)
})

it('opens only same-origin paths; notification clicks do not grant item/contact access', async () => {
  const sw = worker(), close = vi.fn()
  for (const path of ['https://evil.test/private', '//evil.test/private', 'javascript:alert(1)', 'https://user:pass@communalcache.com/', '/\\evil.test/private', '/\n/evil.test']) {
    await sw.fire('notificationclick', { notification: { close, data: { path } } })
    expect(sw.openWindow).toHaveBeenLastCalledWith('https://communalcache.com/')
  }
  await sw.fire('notificationclick', { notification: { close, data: { path: '/requests?from=push' } } })
  expect(sw.openWindow).toHaveBeenLastCalledWith('https://communalcache.com/requests?from=push')
  sw.matchAll.mockResolvedValue([{ url: 'https://communalcache.com/requests', focus: sw.focus }])
  await sw.fire('notificationclick', { notification: { close, data: { path: '/requests' } } })
  expect(sw.focus).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledTimes(8)
})
