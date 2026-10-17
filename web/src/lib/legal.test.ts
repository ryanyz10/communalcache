import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppRoutes, Ready } from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import { AppHeader } from '../components/AppHeader'
import { ApiError, type Me } from './api'
import { legalCopy } from './legalCopy'

const user: Me = { id: 'owner', display_name: 'Neighbor', email: 'private-auth@example.test' }

beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://communalcache.com' })
  vi.stubGlobal('sessionStorage', { getItem: () => null })
  vi.stubGlobal('localStorage', { getItem: () => '1' })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function render(path: string, state: 'signed-out' | 'pending' | 'error' | 'signed-in' = 'signed-out') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  if (state !== 'pending') client.setQueryData(['me'], state === 'signed-in' ? user : null)
  if (state === 'error') client.getQueryCache().find({ queryKey: ['me'] })!.setState({ status: 'error', error: new ApiError(503, 'unavailable') })
  const children = createElement('div', null, createElement(AppHeader), createElement(AppRoutes))
  const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(AuthProvider, { children: createElement(MemoryRouter, { initialEntries: [path] }, createElement(Ready, { children })) })))
  client.clear()
  return markup
}

it.each(['/privacy', '/terms'])('renders %s publicly, even while auth is pending or unavailable, without private user data', path => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  for (const state of ['signed-out', 'pending', 'error', 'signed-in'] as const) {
    const markup = render(path, state)
    expect(markup).toContain(`<h1 id="legal-heading">${path === '/privacy' ? 'Privacy policy' : 'Terms of use'}</h1>`)
    expect(markup).toContain('Ryan Zhou (an individual)')
    expect(markup).toContain('ryanyz10+communalcache@gmail.com')
    expect(markup).toContain('href="mailto:ryanyz10+communalcache@gmail.com"')
    expect(markup).toContain('Effective date: <time dateTime="2026-10-17">2026-10-17</time>')
    expect(markup).toContain('at least 13')
    expect(markup).toContain('class="cc-legal-back" href="/"')
    expect(markup).toContain(legalCopy.back)
    expect(markup).not.toMatch(/Desktop navigation|Mobile navigation|Email me a sign-in link|cc-neutral-loading|cc-shimmer/)
    expect(markup).not.toContain(user.email)
    expect(markup).not.toContain(user.display_name)
  }
  expect(fetch).not.toHaveBeenCalled()
})

it('links to both policies from the landing footer, sign-in and invite sign-in screens', () => {
  for (const path of ['/', '/login', '/login?invite=1', `/join/11111111-1111-4111-8111-111111111111.${'a'.repeat(43)}`]) {
    const markup = render(path)
    const navigation = markup.match(/<nav class="cc-legal-links"[^>]*>[\s\S]*?<\/nav>/)?.[0]
    expect(navigation).toContain('aria-label="Privacy and terms"')
    expect(navigation).toMatch(/href="\/privacy"[^>]*>Privacy policy<\/a>/)
    expect(navigation).toMatch(/href="\/terms"[^>]*>Terms of use<\/a>/)
    if (path === '/') expect(markup.match(/<footer[\s\S]*?<\/footer>/)?.[0]).toContain(navigation)
    expect(markup).not.toContain(user.email)
  }
})
