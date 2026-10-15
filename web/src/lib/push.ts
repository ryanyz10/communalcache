import { apiFetch } from './api'

export const PUSH_OWNER_KEY = 'communalcache-push-owner'

export function pushSupport() {
  const supported = typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const ios = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
  const standalone = typeof window !== 'undefined' && typeof navigator !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
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

export async function subscriptionForAccount(registration: ServiceWorkerRegistration, userId: string) {
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription || localStorage.getItem(PUSH_OWNER_KEY) === userId) return subscription
  await disablePush()
  return null
}

export async function disablePush() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration('/')
  const subscription = await registration?.pushManager.getSubscription()
  try {
    if (subscription) await apiFetch('/api/push/subscribe', { method: 'DELETE', body: { endpoint: subscription.endpoint } })
  } finally {
    // Even a server/network failure must not leave a shared browser receiving its previous account's push.
    if (subscription) await subscription.unsubscribe()
    localStorage.removeItem(PUSH_OWNER_KEY)
    for (const notification of await registration?.getNotifications() ?? []) notification.close()
  }
}
