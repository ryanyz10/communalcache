import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { LoginPage } from '../pages/LoginPage'
import { MagicLinkPage } from '../pages/MagicLinkPage'
import { readMagicLink, sendSignInEmail, verifyMagicLink } from './magicLinks'
import { destinationAfterLogin, peekJoinToken } from './pendingJoin'
import { ApiError, errorMessage } from './api'

const token = 'A'.repeat(32)
const invite = `11111111-1111-4111-8111-111111111111.${'a'.repeat(43)}`
beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
  })
  vi.stubGlobal('location', { hash: `#token=${token}`, pathname: '/auth/link', search: '', origin: 'https://communalcache.com' })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function render(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['me'], null)
  const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, null, element) })))
  client.clear()
  return markup
}

it('routes landing assets through the Worker privacy headers in every inherited environment', async () => {
  const config = JSON.parse(await readFile(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8'))
  expect(config.assets.run_worker_first).toContain('/auth/link')
  expect(config.env.staging).not.toHaveProperty('assets')
  expect(config.env.production).not.toHaveProperty('assets')
})

it('makes the link primary and code fallback secondary without a combined sign-in email', () => {
  const markup = render(createElement(LoginPage))
  expect(markup).toContain('type="submit"')
  expect(markup).toContain('Email me a sign-in link')
  expect(markup).toContain('type="button"')
  expect(markup).toContain('Use a 6-digit code instead')
  expect(markup.indexOf('Email me a sign-in link')).toBeLessThan(markup.indexOf('Use a 6-digit code instead'))
  expect(markup).not.toContain('id="code"')
  expect(markup).toContain('for="email"')
})

it('renders a scanner-safe Continue page without verifying, fetching or exposing its token in markup', () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  const markup = render(createElement(MagicLinkPage))
  expect(markup).toContain('>Continue</button>')
  expect(markup).toContain('Opening this page does not use your link')
  expect(markup).toContain('Link not working? Get a new one')
  expect(markup).not.toContain(token)
  expect(fetchMock).not.toHaveBeenCalled()
  vi.stubGlobal('location', { hash: '#token=bad' })
  const invalid = render(createElement(MagicLinkPage))
  expect(invalid).toContain('role="alert"')
  expect(invalid).toContain('Request a new link or use an email code')
  expect(invalid).not.toContain('>Continue</button>')
})

it('reads a fragment locally and only an explicit verification call POSTs its token', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: true, callback_url: 'https://communalcache.com/' }))
  const link = readMagicLink(`#token=${token}&callbackURL=%2Frequests`)!
  expect(link).toMatchObject({ token, callbackURL: '/requests', newUserCallbackURL: '/requests', errorCallbackURL: '/requests' })
  expect(fetchMock).not.toHaveBeenCalled()
  await verifyMagicLink(link)
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/magic-link/verify', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: JSON.stringify(link) }))
  expect(String(fetchMock.mock.calls[0][0])).not.toContain(token)
  expect(readMagicLink('#token=bad')).toBeNull()
  expect(readMagicLink(`#token=${token}&padding=${'A'.repeat(24_576)}`)).toBeNull()
})

it('preserves pending invites across link send, Continue and code fallback without copying secrets into auth data', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ success: true, callback_url: 'https://communalcache.com/' }))
  await sendSignInEmail(' own@example.test ', 'link', invite)
  expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/sign-in/magic-link', expect.objectContaining({ body: JSON.stringify({ email: 'own@example.test' }) }))
  expect(peekJoinToken()).toBe(invite)
  await verifyMagicLink(readMagicLink(`#token=${token}`)!)
  expect(destinationAfterLogin()).toBe(`/join/${invite}`)
  await sendSignInEmail('own@example.test', 'code', invite)
  expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/email-otp/send-verification-otp', expect.objectContaining({ body: JSON.stringify({ email: 'own@example.test', type: 'sign-in' }) }))
  expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(invite)
  expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('callbackURL":"/join/')
})

it('offers resend/code recovery after verification or delivery errors without dropping a saved invite', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'email_unavailable' }, { status: 502 }))
  await expect(sendSignInEmail('own@example.test', 'link', invite)).rejects.toMatchObject({ status: 502 })
  expect(peekJoinToken()).toBe(invite)
  fetchMock.mockResolvedValue(Response.json({ error: 'invalid_magic_link' }, { status: 400 }))
  await expect(verifyMagicLink(readMagicLink(`#token=${token}`)!)).rejects.toMatchObject({ code: 'invalid_magic_link' })
  expect(errorMessage(new ApiError(400, 'invalid_magic_link'))).toContain('Request a new link or use an email code')
  expect(peekJoinToken()).toBe(invite)
})
