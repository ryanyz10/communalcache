import { expect, it } from 'vitest'
import { buildPushPayload, encryptNotification } from '@block65/webcrypto-web-push'

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), char => char.charCodeAt(0))
const text = (value: string) => new TextEncoder().encode(value)
async function hkdf(input: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey('raw', input, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}
async function fixture() {
  const recipient = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', recipient.publicKey) as ArrayBuffer)
  const auth = crypto.getRandomValues(new Uint8Array(16))
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const privateJwk = await crypto.subtle.exportKey('jwk', vapid.privateKey) as JsonWebKey
  return { recipient, publicKey, auth, vapid, subscription: { endpoint: 'https://web.push.apple.com/test-token', expirationTime: null, keys: { p256dh: encode(publicKey), auth: encode(auth) } }, vapidKeys: { publicKey: encode(new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey) as ArrayBuffer)), privateKey: privateJwk.d!, subject: 'https://communalcache.com' } }
}

it('encrypts RFC 8291 aes128gcm in workerd and independently decrypts with the held subscription private key', async () => {
  const { recipient, publicKey, auth, subscription, vapidKeys } = await fixture()
  const message = { title: 'Communal Cache', body: 'Your request was approved', path: '/requests' }
  const payload = await buildPushPayload({ data: message, options: { ttl: 60 } }, subscription, vapidKeys)
  expect(payload.headers['content-encoding']).toBe('aes128gcm')
  expect(payload.body.byteLength).toBe(4096)
  const bytes = payload.body, salt = bytes.slice(0, 16)
  expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(16)).toBe(4096)
  expect(bytes[20]).toBe(65)
  const senderBytes = bytes.slice(21, 86)
  const sender = await crypto.subtle.importKey('raw', senderBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const agreement = { name: 'ECDH', public: sender }
  const shared = new Uint8Array(await crypto.subtle.deriveBits(agreement, recipient.privateKey, 256))
  const info = new Uint8Array([...text('WebPush: info\0'), ...publicKey, ...senderBytes])
  const ikm = await hkdf(shared, auth, info, 32)
  const cek = await hkdf(ikm, salt, text('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(ikm, salt, text('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, bytes.slice(86)))
  let end = padded.length - 1
  while (padded[end] === 0) end--
  expect(padded[end]).toBe(2)
  expect(JSON.parse(new TextDecoder().decode(padded.slice(0, end)))).toEqual(message)
  const corrupt = bytes.slice(86)
  corrupt[0] ^= 1
  await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, corrupt)).rejects.toThrow()
})

it('signs RFC 8292 VAPID ES256 with the push-service audience and verifies the signature under workerd', async () => {
  const { vapid, vapidKeys, subscription } = await fixture()
  const payload = await buildPushPayload({ data: { path: '/requests' } }, subscription, vapidKeys)
  const authorization = payload.headers.authorization
  expect(authorization).toMatch(/^vapid t=.+, k=.+$/)
  const token = authorization.slice('vapid t='.length).split(', k=')[0]
  const [header, claims, signature] = token.split('.')
  expect(JSON.parse(new TextDecoder().decode(decode(header)))).toMatchObject({ alg: 'ES256' })
  const decoded = JSON.parse(new TextDecoder().decode(decode(claims))) as { aud: string; sub: string; exp: number }
  expect(decoded).toMatchObject({ aud: 'https://web.push.apple.com', sub: 'https://communalcache.com' })
  expect(decoded.exp - Date.now() / 1000).toBeGreaterThan(43_190)
  expect(decoded.exp - Date.now() / 1000).toBeLessThanOrEqual(43_200)
  expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapid.publicKey, decode(signature), text(`${header}.${claims}`))).toBe(true)
  await expect(encryptNotification(subscription, new Uint8Array(3994))).rejects.toThrow('maximum is 3993')
})

it('matches the RFC 5869 SHA-256 test vector used by the independent RFC 8291 decryption proof', async () => {
  const bytes = await hkdf(new Uint8Array(22).fill(11), Uint8Array.from({ length: 13 }, (_, index) => index), Uint8Array.from({ length: 10 }, (_, index) => 240 + index), 42)
  expect(Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865')
})
