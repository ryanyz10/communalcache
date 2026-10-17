import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { LoginForm } from '../pages/LoginPage'
import { GoogleSignInButton } from '../components/GoogleSignInButton'
import { googleSignInError, googleSignInUrl } from './googleSignIn'
import { peekJoinToken, stashJoinToken } from './pendingJoin'

const invite = `11111111-1111-4111-8111-111111111111.${'A'.repeat(43)}`
const authorize = 'https://accounts.google.com/o/oauth2/v2/auth?state=fixture-state'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function storage() {
  const values = new Map<string, string>()
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }
  vi.stubGlobal('sessionStorage', store); vi.stubGlobal('localStorage', store)
}
function render(google: boolean | undefined, element: ReturnType<typeof createElement>, path = '/login') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['me'], null)
  client.setQueryData(['config'], { google_sign_in: google, turnstile_site_key: '' })
  const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, { initialEntries: [path] }, element) })))
  client.clear()
  return markup
}

it('hides the Google button when disabled, missing or config is not yet loaded', () => {
  for (const value of [false, undefined]) expect(render(value, createElement(GoogleSignInButton, { disabled: false, onClick() {} }))).toBe('')
  const client = new QueryClient()
  expect(renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(GoogleSignInButton, { disabled: false, onClick() {} })))).toBe('')
  client.clear()
})

it('shows a locally drawn four-color Google G, explicit label and a non-submit button', () => {
  const markup = render(true, createElement(GoogleSignInButton, { disabled: false, onClick() {} }))
  expect(markup).toContain('type="button"')
  expect(markup).toContain('Continue with Google')
  for (const color of ['#4285F4', '#34A853', '#FBBC05', '#EA4335']) expect(markup).toContain(color)
  expect(markup).toContain('aria-hidden="true"')
  expect(markup).not.toMatch(/<img|https?:/)
  expect(render(true, createElement(GoogleSignInButton, { disabled: true, onClick() {} }))).toContain('disabled=""')
})

it('renders Google on normal and invite sign-in without disabling email fallback, and shows friendly callback errors without reflecting provider text', () => {
  for (const inviteToken of [undefined, invite]) {
    const markup = render(true, createElement(LoginForm, { inviteToken }), '/login?error=access_denied&error_description=private-provider-detail')
    expect(markup).toContain('Continue with Google')
    expect(markup).toContain('Email me a sign-in link')
    expect(markup).toContain('Use a 6-digit code instead')
    expect(markup).toContain(googleSignInError)
    expect(markup).not.toContain('private-provider-detail')
    if (inviteToken) expect(markup).toContain('Invite saved on this browser')
  }
})

it('preserves a current or saved invite as both success and error callback through redirect, without Turnstile', async () => {
  storage()
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ url: authorize }))
  for (const token of [invite, undefined]) {
    expect(await googleSignInUrl(token)).toBe(authorize)
    const [path, init] = fetch.mock.calls.at(-1)!
    expect(path).toBe('/api/auth/sign-in/social')
    expect(JSON.parse(init!.body as string)).toEqual({ provider: 'google', callbackURL: `/join/${invite}`, errorCallbackURL: `/join/${invite}` })
    expect(new Headers(init!.headers).has('X-Turnstile-Token')).toBe(false)
    expect(peekJoinToken()).toBe(invite)
  }
})

it('uses a safe login error destination without an invite and never navigates to an unexpected authorization URL', async () => {
  storage()
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ url: authorize }))
  await googleSignInUrl()
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ provider: 'google', callbackURL: '/', errorCallbackURL: '/login' })
  for (const url of ['https://evil.test/', 'https://accounts.google.com.evil.test/', 'https://accounts.google.com/other', 'javascript:alert(1)', 'https://user:pass@accounts.google.com/o/oauth2/v2/auth']) {
    fetch.mockResolvedValueOnce(Response.json({ url }))
    await expect(googleSignInUrl()).rejects.toThrow()
  }
})

it('keeps the invite saved after the initiation endpoint fails', async () => {
  storage(); stashJoinToken(invite)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'auth_unavailable' }, { status: 503 }))
  await expect(googleSignInUrl()).rejects.toThrow()
  expect(peekJoinToken()).toBe(invite)
})
