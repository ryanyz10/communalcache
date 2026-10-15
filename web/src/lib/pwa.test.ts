/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

function worker() {
  const handlers = new Map<string, (event: unknown) => void>()
  const showNotification = vi.fn(async () => {})
  const focus = vi.fn(async () => {})
  const matchAll = vi.fn(async () => [] as { url: string; focus: () => Promise<void> }[])
  const openWindow = vi.fn(async () => {})
  const self = { location: { origin: 'https://communalcache.com' }, addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler), skipWaiting: vi.fn(async () => {}), registration: { showNotification }, clients: { claim: vi.fn(async () => {}), matchAll, openWindow } }
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), { self, URL })
  async function fire(name: string, data: Record<string, unknown>) {
    let work = Promise.resolve<unknown>(undefined)
    handlers.get(name)!({ ...data, waitUntil: (promise: Promise<unknown>) => { work = promise } })
    await work
  }
  return { handlers, fire, showNotification, focus, matchAll, openWindow }
}

it('links an installable standalone manifest and reuses a local icon without caching authenticated responses', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../public/manifest.webmanifest', import.meta.url), 'utf8'))
  expect(manifest).toMatchObject({ name: 'Communal Cache', start_url: '/', scope: '/', display: 'standalone' })
  expect(manifest.icons).toEqual([expect.objectContaining({ src: '/favicon.svg', type: 'image/svg+xml' })])
  expect(readFileSync(new URL('../../public/favicon.svg', import.meta.url), 'utf8')).toContain('<svg')
  expect(readFileSync(new URL('../../index.html', import.meta.url), 'utf8')).toContain('/manifest.webmanifest')
  expect(worker().handlers.has('fetch')).toBe(false)
})

it('displays push payloads and falls back visibly for malformed data', async () => {
  const sw = worker()
  await sw.fire('push', { data: { json: () => ({ title: 'Approved', body: 'Your item request', path: '/requests' }) } })
  expect(sw.showNotification).toHaveBeenCalledWith('Approved', { body: 'Your item request', icon: '/favicon.svg', data: { path: '/requests' } })
  await sw.fire('push', { data: { json: () => { throw new Error('bad JSON') } } })
  expect(sw.showNotification).toHaveBeenLastCalledWith('Communal Cache', expect.objectContaining({ data: { path: '/' } }))
})

it('opens only same-origin relative paths and refuses foreign, protocol-relative, credentialed or script click targets', async () => {
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
