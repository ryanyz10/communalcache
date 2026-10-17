import { buildPushPayload } from '@block65/webcrypto-web-push'
import { currentPush, removeExpiredPush, type PushRow } from './db'

export function pushEndpoint(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048 || value.trim() !== value) throw new Error('invalid_push_endpoint')
  let url: URL
  try { url = new URL(value) }
  catch { throw new Error('invalid_push_endpoint') }
  const host = url.hostname
  const allowedHost = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(host) || host.endsWith('.notify.windows.com')
  // ponytail: this allowlist is the egress control; Workers private-IP/DNS-rebinding blocking is UNVERIFIED.
  if (!allowedHost || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw new Error('invalid_push_endpoint')
  return url.href
}

function keyBytes(value: unknown, length: number) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid_push_keys')
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), char => char.charCodeAt(0))
  } catch {
    throw new Error('invalid_push_keys')
  }
  const canonical = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  if (bytes.length !== length || canonical !== value) throw new Error('invalid_push_keys')
  return bytes
}

export async function pushSubscription(body: Record<string, unknown>) {
  const endpoint = pushEndpoint(body.endpoint)
  const keys = body.keys as Record<string, unknown> | undefined
  if (!keys || typeof keys !== 'object') throw new Error('invalid_push_keys')
  const publicKeyBytes = keyBytes(keys.p256dh, 65)
  keyBytes(keys.auth, 16)
  if (publicKeyBytes[0] !== 4) throw new Error('invalid_push_keys')
  try {
    await crypto.subtle.importKey('raw', publicKeyBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  } catch {
    throw new Error('invalid_push_keys')
  }
  return { endpoint, p256dh: keys.p256dh as string, auth: keys.auth as string }
}

export async function sendPush(env: Env, row: PushRow, message: { title: string; body: string; path: string }, signal: AbortSignal) {
  const subscription = await pushSubscription({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } })
  signal.throwIfAborted()
  const payload = await buildPushPayload({ data: message, options: { ttl: 300, urgency: 'normal' } }, {
    endpoint: subscription.endpoint, expirationTime: null, keys: { p256dh: subscription.p256dh, auth: subscription.auth },
  }, { subject: env.APP_BASE_URL, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY })
  if (!await currentPush(env.DB, row.id, row.user_id)) return 'gone' as const
  signal.throwIfAborted()
  const response = await fetch(subscription.endpoint, {
    ...payload, redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  })
  await response.body?.cancel()
  signal.throwIfAborted()
  if (response.status === 404 || response.status === 410) {
    await removeExpiredPush(env.DB, row.id, row.user_id)
    return 'gone' as const
  }
  if (!response.ok) throw new Error('Push delivery unavailable')
  return 'sent' as const
}
