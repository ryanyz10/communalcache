import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { json, securityHeaders } from '../src/http'
import { appRequest, base, login } from './helpers'

function baseline(response: Response, hsts = true) {
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  expect(response.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'")
  expect(response.headers.get('Content-Security-Policy-Report-Only')).toContain("script-src 'self' https://challenges.cloudflare.com")
  expect(response.headers.get('Content-Security-Policy-Report-Only')).toContain("style-src 'self' 'unsafe-inline'")
  expect(response.headers.get('Content-Security-Policy-Report-Only')).toContain("worker-src 'self'")
  expect(response.headers.get('Permissions-Policy')).toContain('camera=(), microphone=(), geolocation=()')
  expect(response.headers.get('Permissions-Policy')).toContain('clipboard-write=(self), web-share=(self)')
  expect(response.headers.get('Permissions-Policy')).not.toMatch(/notifications|push/)
  expect(response.headers.get('Strict-Transport-Security')).toBe(hsts ? 'max-age=31536000' : null)
}

it('overwrites weaker upstream security headers without changing status, body, cache, content or cookies', async () => {
  const headers = { 'X-Frame-Options': 'SAMEORIGIN', 'X-Content-Type-Options': 'off', 'Referrer-Policy': 'unsafe-url',
    'Content-Security-Policy': "frame-ancestors *", 'Content-Security-Policy-Report-Only': "script-src * 'unsafe-eval'",
    'Permissions-Policy': 'camera=*', 'Strict-Transport-Security': 'max-age=0', 'Cache-Control': 'private, no-store',
    'Content-Type': 'image/png', 'Content-Length': '3', 'Set-Cookie': 'fixture=public-test; HttpOnly' }
  const response = securityHeaders(new Response('png', { status: 201, headers }), base, '/photo')
  baseline(response)
  expect(response.status).toBe(201)
  expect(new TextDecoder().decode(await response.arrayBuffer())).toBe('png')
  for (const name of ['Cache-Control', 'Content-Type', 'Content-Length', 'Set-Cookie']) expect(response.headers.get(name)).toBe(headers[name as keyof typeof headers])
  expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
})

it('covers HTML/static passthrough, JSON, errors, admin denial and OPTIONS at the Worker boundary', async () => {
  const bindings = { ...env, ASSETS: { fetch: vi.fn(async () => new Response('<app/>', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=0', 'Referrer-Policy': 'unsafe-url' } })) } as unknown as Fetcher }
  for (const [path, method, status] of [
    ['/', 'GET', 200], ['/assets/app.js', 'GET', 200], ['/api/config', 'GET', 200],
    ['/api/missing', 'GET', 404], ['/api/me', 'GET', 401], ['/admin', 'GET', 404],
    ['/api/admin/overview', 'GET', 404], ['/api/config', 'POST', 405], ['/api/config', 'OPTIONS', 204],
  ] as const) {
    const response = await worker.fetch(appRequest(path, { method }), bindings)
    expect(response.status).toBe(status)
    baseline(response)
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(response.headers.get('Cache-Control')).toBe(path.startsWith('/api') || path === '/admin' ? (method === 'OPTIONS' ? null : 'no-store') : 'public, max-age=0')
  }
  bindings.ASSETS.fetch = vi.fn(async () => { throw new Error('private asset failure') }) as typeof bindings.ASSETS.fetch
  const failure = await worker.fetch(appRequest('/'), bindings)
  baseline(failure)
  expect(failure.status).toBe(500)
  expect(await failure.json()).toEqual({ error: 'internal_error' })
})

it('keeps no-referrer on invite/link/Google callback successes and failures, and existing stricter admin responses', async () => {
  const bindings = { ...env, ASSETS: { fetch: async () => new Response('<app/>') } as unknown as Fetcher }
  for (const path of ['/join/fixture', '/auth/link', '/api/auth/callback/google']) {
    const response = await worker.fetch(appRequest(path), bindings)
    baseline(response)
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    if (path === '/auth/link') expect(response.headers.get('Cache-Control')).toBe('no-store')
  }
  expect(securityHeaders(new Response(null, { headers: { 'Referrer-Policy': 'no-referrer' } }), base, '/admin').headers.get('Referrer-Policy')).toBe('no-referrer')
})

it('never adds or retains HSTS for local/HTTP/invalid app origins', async () => {
  for (const appBase of ['http://localhost:8787', 'https://localhost:8787', 'https://127.0.0.1', 'https://[::1]', 'https://dev.localhost', 'http://communalcache.com', 'invalid']) {
    baseline(securityHeaders(json({ ok: true }), appBase, '/api/config'), false)
    const local = securityHeaders(new Response(null, { headers: { 'Strict-Transport-Security': 'max-age=31536000' } }), appBase, '/')
    expect(local.headers.has('Strict-Transport-Security')).toBe(false)
  }
  baseline(await worker.fetch(appRequest('/api/config'), { ...env, APP_BASE_URL: 'http://localhost:8787' }), false)
  // The committed public app origin must not pin a local HTTPS dev host either.
  for (const origin of ['https://localhost:8787', 'https://127.0.0.1', 'http://communalcache.com']) {
    baseline(await worker.fetch(new Request(origin + '/api/config'), env), false)
  }
  baseline(securityHeaders(json({ ok: true }), 'https://communalcache-staging.ryanyz10-be6.workers.dev', '/'))
})

it('preserves private/no-store photo streaming and auth session cookies under the baseline', async () => {
  const caller = await login()
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: caller.cookie, body: { display_name: 'Neighbor' } }), env)
  const jpeg = new Uint8Array([255, 216, 255, 217])
  const uploaded = await worker.fetch(new Request(base + '/api/me/photo', { method: 'POST', headers: { Cookie: caller.cookie, Origin: base, 'Content-Type': 'image/jpeg' }, body: jpeg }), env)
  expect(uploaded.status).toBe(200); baseline(uploaded)
  const photo = await worker.fetch(appRequest('/api/me/photo', { cookie: caller.cookie }), env)
  baseline(photo)
  expect(photo.headers.get('Cache-Control')).toBe('private, no-store')
  expect(photo.headers.get('Content-Type')).toBe('image/jpeg')
  expect(new Uint8Array(await photo.arrayBuffer())).toEqual(jpeg)
  const session = await worker.fetch(appRequest('/api/auth/get-session', { cookie: caller.cookie }), env)
  baseline(session)
  expect(session.headers.get('Cache-Control')).toBe('no-store')
  expect(caller.setCookie).toMatch(/HttpOnly.*Secure.*SameSite=Lax/i)
})
