import { apiFetch } from './api'
import { iosDevice, standaloneMode } from './install'

export const PUSH_OWNER_KEY = 'communalcache-push-owner'
const accountCache = 'communalcache-push-account'
const accountPath = '/__push-account'

export async function setPushAccount(userId: string | null, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (typeof caches === 'undefined') return
  try {
    const cache = await caches.open(accountCache)
    signal?.throwIfAborted()
    if (userId) await cache.put(accountPath, new Response(userId))
    else await cache.delete(accountPath)
  } catch { /* Unavailable storage makes the service worker use generic text. */ }
  signal?.throwIfAborted()
}

export async function reconcilePushAccount(userId: string | null, signal?: AbortSignal) {
  await setPushAccount(null, signal)
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration('/')
      signal?.throwIfAborted()
      if (registration && userId) await subscriptionForAccount(registration, userId, signal)
      else if (registration) await disablePush(signal)
    }
    await setPushAccount(userId, signal)
  } catch { /* Keep notification text generic when ownership cleanup cannot finish. */ }
  signal?.throwIfAborted()
}

export function pushSupport() {
  const supported = typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const ios = iosDevice()
  const standalone = standaloneMode()
  return { supported, ios, standalone: !!standalone }
}

export async function enablePush(registration: ServiceWorkerRegistration, publicKey: string, userId: string) {
  const support = pushSupport()
  if (!support.supported || (support.ios && !support.standalone)) throw new Error('Install this app before enabling notifications on iPhone or iPad.')
  // This is the first async operation so permission remains attached to the button gesture.
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notification permission was not granted. You can change it in browser settings.')
  const key = Uint8Array.from(atob(publicKey.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(publicKey.length / 4) * 4, '=')), char => char.charCodeAt(0))
  const existing = await registration.pushManager.getSubscription()
  const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  try {
    await apiFetch('/api/push/subscribe', { body: subscription.toJSON() })
    localStorage.setItem(PUSH_OWNER_KEY, userId)
  }
  catch (error) {
    // A rejected reassignment must not leave this browser receiving its previous account's push.
    await subscription.unsubscribe()
    localStorage.removeItem(PUSH_OWNER_KEY)
    throw error
  }
}

export async function subscriptionForAccount(registration: ServiceWorkerRegistration, userId: string, signal?: AbortSignal) {
  const subscription = await registration.pushManager.getSubscription()
  signal?.throwIfAborted()
  if (!subscription || localStorage.getItem(PUSH_OWNER_KEY) === userId) return subscription
  await disablePush(signal)
  return null
}

export async function disablePush(signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration('/')
  signal?.throwIfAborted()
  const subscription = await registration?.pushManager.getSubscription()
  signal?.throwIfAborted()
  try {
    if (subscription) await apiFetch('/api/push/subscribe', { method: 'DELETE', body: { endpoint: subscription.endpoint }, signal })
  } finally {
    // A cancelled old identity must not tear down the new account's installation.
    signal?.throwIfAborted()
    if (subscription) await subscription.unsubscribe()
    signal?.throwIfAborted()
    localStorage.removeItem(PUSH_OWNER_KEY)
    const notifications = await registration?.getNotifications() ?? []
    signal?.throwIfAborted()
    for (const notification of notifications) notification.close()
  }
}
