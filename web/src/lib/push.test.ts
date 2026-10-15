import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '../auth/AuthProvider'
import { PushControls } from '../pages/PushControls'
import { disablePush, enablePush, PUSH_OWNER_KEY, pushSupport, subscriptionForAccount } from './push'

const publicKey = 'BA'.repeat(43) + 'A'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function browser(ios = false, standalone = true) {
  const subscription = { endpoint: 'https://fcm.googleapis.com/browser', toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/browser', keys: { p256dh: 'browser-key', auth: 'auth-key' } }), unsubscribe: vi.fn(async () => true) }
  const notification = { close: vi.fn() }
  const registration = { pushManager: { getSubscription: vi.fn(async () => null as typeof subscription | null), subscribe: vi.fn(async () => subscription) }, getNotifications: vi.fn(async () => [notification]) }
  const permission = vi.fn(async () => 'granted')
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() })
  vi.stubGlobal('Notification', { requestPermission: permission })
  vi.stubGlobal('window', { PushManager: {}, Notification: {}, matchMedia: () => ({ matches: standalone }) })
  vi.stubGlobal('navigator', { userAgent: ios ? 'iPhone' : 'Desktop', platform: ios ? 'iPhone' : 'Linux', maxTouchPoints: ios ? 1 : 0, serviceWorker: { getRegistration: vi.fn(async () => registration), register: vi.fn(async () => registration), ready: Promise.resolve(registration) } })
  return { subscription, registration, notification, permission }
}

it('requests permission only from explicit enable and posts the browser subscription using cookies', async () => {
  const { registration, permission, subscription } = browser()
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
  expect(permission).not.toHaveBeenCalled()
  const enabled = enablePush(registration as unknown as ServiceWorkerRegistration, publicKey, 'caller')
  expect(permission).toHaveBeenCalledOnce()
  await enabled
  expect(registration.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) })
  expect(fetchMock.mock.calls[0][0]).toBe('/api/push/subscribe')
  expect(fetchMock.mock.calls[0][1]?.credentials).toBe('same-origin')
  expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual(subscription.toJSON())
  expect(localStorage.setItem).toHaveBeenCalledWith(PUSH_OWNER_KEY, 'caller')
})

it('adopts an existing browser subscription for the new account and unsubscribes locally if reassignment fails', async () => {
  const { registration, subscription } = browser()
  registration.pushManager.getSubscription.mockResolvedValue(subscription)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'push_limit' }, { status: 409 }))
  await expect(enablePush(registration as unknown as ServiceWorkerRegistration, publicKey, 'caller')).rejects.toMatchObject({ code: 'push_limit' })
  expect(registration.pushManager.subscribe).not.toHaveBeenCalled()
  expect(subscription.unsubscribe).toHaveBeenCalledOnce()
})

it('keeps same-account browser subscriptions but clears previous-account subscriptions without asking permission', async () => {
  const { registration, subscription, permission } = browser()
  registration.pushManager.getSubscription.mockResolvedValue(subscription)
  vi.mocked(localStorage.getItem).mockReturnValue('first')
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
  expect(await subscriptionForAccount(registration as unknown as ServiceWorkerRegistration, 'first')).toBe(subscription)
  expect(fetchMock).not.toHaveBeenCalled()
  expect(await subscriptionForAccount(registration as unknown as ServiceWorkerRegistration, 'second')).toBeNull()
  expect(subscription.unsubscribe).toHaveBeenCalledOnce()
  expect(permission).not.toHaveBeenCalled()
})

it('requires installed iOS before permission and handles denial without subscribing', async () => {
  const { registration, permission } = browser(true, false)
  await expect(enablePush(registration as unknown as ServiceWorkerRegistration, publicKey, 'caller')).rejects.toThrow('Install this app')
  expect(permission).not.toHaveBeenCalled()
  browser(true, true)
  const denied = browser()
  denied.permission.mockResolvedValue('denied')
  await expect(enablePush(denied.registration as unknown as ServiceWorkerRegistration, publicKey, 'caller')).rejects.toThrow('not granted')
  expect(denied.registration.pushManager.subscribe).not.toHaveBeenCalled()
})

it('detects iPad desktop mode and standalone mode without a programmable install prompt', () => {
  browser(true, true)
  expect(pushSupport()).toMatchObject({ supported: true, ios: true, standalone: true })
  vi.stubGlobal('navigator', { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 })
  expect(pushSupport().ios).toBe(true)
})

it('removes the caller-scoped server subscription, then unsubscribes and closes visible notifications', async () => {
  const { registration, subscription, notification } = browser()
  registration.pushManager.getSubscription.mockResolvedValue(subscription)
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
  await disablePush()
  expect(fetchMock).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({ method: 'DELETE', credentials: 'same-origin', body: JSON.stringify({ endpoint: subscription.endpoint }) }))
  expect(subscription.unsubscribe).toHaveBeenCalledOnce()
  expect(notification.close).toHaveBeenCalledOnce()
})

it('cleans up push before auth logout and does not log out if server cleanup failed', async () => {
  const { registration, subscription } = browser()
  registration.pushManager.getSubscription.mockResolvedValue(subscription)
  const calls: string[] = []
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => { calls.push(`${options?.method}:${path}`); return new Response(null, { status: 204 }) })
  const client = new QueryClient()
  client.setQueryData(['me'], { id: 'caller', display_name: 'Neighbor', email: 'own@example.test' })
  let logout!: () => Promise<void>
  function Probe() { logout = useAuth().signOut; return null }
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(Probe) })))
  await logout()
  expect(calls).toEqual(['DELETE:/api/push/subscribe', 'POST:/api/auth/sign-out'])
  expect(subscription.unsubscribe).toHaveBeenCalledOnce()
  fetchMock.mockClear()
  fetchMock.mockImplementation(async () => Response.json({ error: 'unavailable' }, { status: 503 }))
  await expect(logout()).rejects.toMatchObject({ status: 503 })
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/push/subscribe'])
  client.clear()
})

it('renders unsupported/configuration and iOS installation guidance without asking permission', () => {
  const { permission } = browser(true, false)
  const client = new QueryClient()
  client.setQueryData(['config'], { app_base_url: 'https://communalcache.com', better_auth_url: 'https://communalcache.com', vapid_public_key: '' })
  const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PushControls, { userId: 'caller' })))
  expect(markup).toContain('Add to Home Screen')
  expect(markup).toContain('Push is not configured yet')
  expect(markup).toContain('aria-label="Push notifications"')
  expect(markup).toContain('role="switch"')
  expect(permission).not.toHaveBeenCalled()
  client.clear()
})
