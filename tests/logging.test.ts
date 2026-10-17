import { afterEach, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { createScheduledController } from 'cloudflare:test'
import worker from '../src/index'
import { logMethod, logRoute } from '../src/logging'
import { appRequest } from './helpers'

afterEach(() => vi.restoreAllMocks())
const id = '11111111-1111-4111-8111-111111111111'
const privateValue = 'private-auth@example.test'

it.each([
  [`/join/${id}.invite-secret?email=${privateValue}`, '/join/:token'],
  [`/api/caches/${id}/items`, '/api/caches/:id/items'],
  [`/api/caches/${id}/items/${id}?after=private-cursor`, '/api/caches/:id/items/:id'],
  [`/api/caches/${id}/items/${id}/photo?v=private-version`, '/api/caches/:id/items/:id/photo'],
  [`/api/caches/${id}/requests/${id}/approve`, '/api/caches/:id/requests/:id/approve'],
  [`/api/caches/${id}/join-requests/${id}/reject`, '/api/caches/:id/join-requests/:id/reject'],
  [`/api/caches/${id}/members/${id}`, '/api/caches/:id/members/:id'],
  [`/api/me/items/${id}/attachments/${id}`, '/api/me/items/:id/attachments/:id'],
  [`/api/me/requests/${id}/contact`, '/api/me/requests/:id/contact'],
  [`/api/users/${id}/photo?v=private-version`, '/api/users/:id/photo'],
  [`/api/admin/users/${id}/plan`, '/api/admin/users/:id/plan'],
  ['/api/admin/flags/google_sign_in', '/api/admin/flags/google_sign_in'],
  ['/api/auth/callback/google?code=oauth-secret&state=private-state', '/api/auth/callback/google'],
  ['/api/auth/magic-link/verify?token=magic-secret', '/api/auth/magic-link/verify'],
  ['/auth/link#token=magic-secret', '/auth/link'],
  [`/api/caches/${privateValue}/items/private-token`, '/api/caches/:id/items/:id'],
  [`/api/unknown/${privateValue}?token=private-token`, '/api/*'],
  ['/join/private-token/extra/private-data', '/join/*'],
  [`/admin/private-token/${privateValue}`, '/admin/*'],
  [`/files/${privateValue}/private-photo-key`, '/*'],
  ['/api/%65mail/private-token', '/api/*'],
  ['/API/CACHES/private-token/ITEMS/', '/api/caches/:id/items'],
] as const)('normalizes %s to a fixed label without path/query secrets', (path, expected) => {
  const route = logRoute('https://example.test' + path)
  expect(route).toBe(expected)
  expect(route).not.toMatch(/11111111|private-|secret|example\.test|\?|#|%/)
})

it('uses fixed fallbacks for malformed URLs and nonstandard request methods', () => {
  expect(logRoute('not a URL with private-token')).toBe('/*')
  expect(logMethod('GET')).toBe('GET')
  expect(logMethod('PATCH')).toBe('PATCH')
  expect(logMethod('PRIVATE-TOKEN')).toBe('OTHER')
})

it('emits exactly one bounded-shape request event for success and expected HTTP errors', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const [path, status, route] of [
    ['/api/healthz?token=private-token', 200, '/api/healthz'],
    [`/api/unknown/${privateValue}?token=private-token`, 404, '/api/*'],
  ] as const) {
    info.mockClear()
    const response = await worker.fetch(appRequest(path), env)
    expect(response.status).toBe(status)
    expect(info).toHaveBeenCalledExactlyOnceWith({ event: 'request', method: 'GET', route, status, ms: expect.any(Number) })
    const event = info.mock.calls[0][0] as { ms: number }
    expect(event.ms).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(event)).not.toMatch(/private-|example\.test|token=/)
  }
  expect(errors).not.toHaveBeenCalled()
})

it('never logs raw exception names, messages, stacks, headers or bodies on unhandled fetch errors', async () => {
  const error = new Error(`private-token ${privateValue}`)
  error.name = privateValue
  error.stack = 'private stack with invite-secret and photo-key'
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const bindings = { ...env, ASSETS: { fetch: async () => { throw error } } as unknown as Fetcher }
  const request = new Request(`https://example.test/join/${id}.invite-secret?token=private-token`, {
    method: 'POST', headers: { Cookie: 'session=private-session', 'CF-Connecting-IP': '192.0.2.42', 'X-Turnstile-Token': 'private-turnstile' },
    body: JSON.stringify({ email: privateValue, otp: '123456', endpoint: 'private-endpoint', photo: 'private-photo-key' }),
  })
  const response = await worker.fetch(request, bindings)
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'internal_error' })
  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  expect(errors).toHaveBeenCalledExactlyOnceWith({ event: 'unhandled_error', route: '/join/:token', name: 'Error' })
  expect(info).toHaveBeenCalledExactlyOnceWith({ event: 'request', method: 'POST', route: '/join/:token', status: 500, ms: expect.any(Number) })
  expect(JSON.stringify([...errors.mock.calls, ...info.mock.calls])).not.toMatch(/private-|invite-secret|photo-key|example\.test|123456|192\.0\.2/)
})

it.each([false, true])('summarizes queue counts and sanitizes escaped exceptions (fails=%s)', async fails => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  const batch = { messages: [{ body: { email: privateValue, token: 'private-token' }, ack() { if (fails) throw new Error(privateValue) } }] } as unknown as MessageBatch<unknown>
  if (fails) await expect(worker.queue(batch, env)).rejects.toThrow('Queue processing incomplete')
  else await worker.queue(batch, env)
  expect(info).toHaveBeenCalledExactlyOnceWith({ event: 'queue', messages: 1, failed_batches: fails ? 1 : 0 })
  expect(JSON.stringify(info.mock.calls)).not.toContain(privateValue)
})

it.each([false, true])('summarizes independent scheduled jobs without exception payloads (fails=%s)', async fails => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  const prepare = vi.spyOn(env.DB, 'prepare')
  if (fails) prepare.mockImplementation(() => { throw new Error(privateValue) })
  try {
    if (fails) await expect(worker.scheduled(createScheduledController(), env)).rejects.toThrow('Scheduled recovery incomplete')
    else await worker.scheduled(createScheduledController(), env)
    expect(info).toHaveBeenCalledExactlyOnceWith({ event: 'scheduled', jobs: 2, failed_jobs: fails ? 2 : 0 })
    expect(JSON.stringify(info.mock.calls)).not.toContain(privateValue)
  } finally { prepare.mockRestore() }
})
