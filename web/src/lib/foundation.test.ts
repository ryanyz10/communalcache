import { afterEach, beforeEach, it, expect, vi } from 'vitest'
import { apiFetch, ApiError, errorMessage } from './api'
import { clearJoinToken, destinationAfterLogin, peekJoinToken, stashJoinToken, validJoinToken } from './pendingJoin'

const token = '11111111-1111-4111-8111-111111111111.' + 'a'.repeat(43)

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps the pending invite across code delivery, failed login, and name onboarding', async () => {
  stashJoinToken(token)
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: true }))
  await apiFetch('/api/auth/email-otp/send-verification-otp', { body: { email: 'own@example.test', type: 'sign-in' } })
  expect(peekJoinToken()).toBe(token)
  expect(destinationAfterLogin()).toBe('/join/' + token)
  expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(token)
  fetchMock.mockResolvedValue(Response.json({ code: 'INVALID_OTP' }, { status: 400 }))
  await expect(apiFetch('/api/auth/sign-in/email-otp', { body: { email: 'own@example.test', otp: '123456' } })).rejects.toThrow('INVALID_OTP')
  expect(peekJoinToken()).toBe(token)
  fetchMock.mockResolvedValue(Response.json({ id: 'user', display_name: 'Neighbor' }))
  await apiFetch('/api/me', { method: 'PATCH', body: { display_name: 'Neighbor' } })
  expect(destinationAfterLogin()).toBe('/join/' + token)
  clearJoinToken()
  expect(destinationAfterLogin()).toBe('/')
})

it('accepts only cache UUID plus fixed-length base64url invite secrets', () => {
  expect(validJoinToken(token)).toBe(true)
  for (const invalid of ['https://foreign.test', '//foreign.test', 'cache.secret', token + '/', token.slice(0, -1)]) {
    expect(validJoinToken(invalid)).toBe(false)
    expect(() => stashJoinToken(invalid)).toThrow('Invalid invite link')
  }
})

it('uses same-origin cookies with no bearer token or callback secret', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 'caller' }))
  await apiFetch('/api/me')
  expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({ credentials: 'same-origin', method: 'GET' }))
  expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('Authorization')
})

it('shows recoverable errors without exposing provider or credential details', () => {
  expect(errorMessage(new ApiError(502, 'email_unavailable'))).toContain('invite is saved')
  expect(errorMessage(new ApiError(400, 'INVALID_OTP'))).toContain('most recent code')
  expect(errorMessage(new ApiError(429, 'too_many_requests'))).toContain('wait a minute')
  expect(errorMessage(new Error('private provider detail'))).not.toContain('private provider detail')
})
