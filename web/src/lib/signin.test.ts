import { afterEach, expect, it, vi } from 'vitest'
import { createElement, Fragment, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { AppHeader } from '../components/AppHeader'
import { CodeInput } from '../components/CodeInput'
import { NamePreview } from '../components/NamePreview'
import { LoginPage } from '../pages/LoginPage'
import { MagicLinkPage } from '../pages/MagicLinkPage'
import { OnboardingPage } from '../pages/OnboardingPage'
import { JoinPage } from '../pages/JoinPage'
import type { Me } from './api'

function render(page: ReactElement, options: { path?: string; route?: string; me?: Me | null } = {}) {
  vi.stubGlobal('location', { hash: '#token=' + 'A'.repeat(32), origin: 'https://communalcache.com' })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['me'], options.me ?? null)
  const element = createElement(Fragment, null, createElement(AppHeader), page)
  const routes = createElement(Routes, null, createElement(Route, { path: options.route ?? '/login', element }))
  const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, { initialEntries: [options.path ?? '/login'] }, routes) })))
  client.clear()
  return markup
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('renders the approved brand/tagline, email card and large primary/secondary actions without signed-in navigation', () => {
  const markup = render(createElement(LoginPage))
  expect(markup).toContain('Share more,')
  expect(markup).toContain('buy less.')
  expect(markup).toContain('Borrow and lend with your neighbors.')
  expect(markup).toContain('viewBox="0 0 32 32"')
  expect(markup).not.toContain('shape-rendering="crispEdges"')
  expect(markup).not.toContain('M3 9.5 12 4l9 5.5')
  expect(markup).toContain('placeholder="you@example.com"')
  expect(markup).toContain('cc-profile-primary')
  expect(markup).toContain('Email me a sign-in link')
  expect(markup).toContain('Use a 6-digit code instead')
  expect(markup).toContain('Your email stays private')
  expect(markup).not.toContain('Main navigation')
})

it('keeps OTP entry to one labeled native input with six decorative boxes, preserving paste/autofill constraints', () => {
  const markup = renderToStaticMarkup(createElement(CodeInput, { value: '482', onChange: () => {} }))
  expect(markup.match(/<input\b/g)).toHaveLength(1)
  expect(markup.match(/data-code-box=""/g)).toHaveLength(6)
  expect(markup).toContain('for="code"')
  expect(markup).toContain('6-digit code')
  expect(markup).toContain('inputMode="numeric"')
  expect(markup).toContain('autoComplete="one-time-code"')
  expect(markup).toContain('pattern="[0-9]{6}"')
  expect(markup).toContain('maxLength="6"')
  expect(markup).toContain('value="482"')
  expect(markup).toContain('aria-hidden="true"')
  expect(markup).toContain('aria-describedby="code-help"')
  expect(markup).toContain('Use the most recent code you requested')
  expect(markup).not.toContain('type="number"')
})

it('previews a typed name tag and id-derived cat without deriving either from email', () => {
  const filled = renderToStaticMarkup(createElement(NamePreview, { name: '  Ryan  ', userId: 'Mia' }))
  expect(filled).toContain('data-coat="dusk"')
  expect(filled).toContain('>Ryan</strong>')
  expect(filled).toContain('aria-live="polite"')
  const empty = renderToStaticMarkup(createElement(NamePreview, { name: '  ', userId: 'Mia' }))
  expect(empty).toContain('HELLO, MY NAME IS')
  expect(empty).toContain('Your name')
  const escaped = renderToStaticMarkup(createElement(NamePreview, { name: '<Neighbor>', userId: 'Mia' }))
  expect(escaped).toContain('&lt;Neighbor&gt;')
  const onboarding = render(createElement(OnboardingPage), { path: '/', route: '/', me: { id: 'caller', email: 'private@example.test', display_name: null } })
  expect(onboarding).toContain('Pick your cat')
  expect(onboarding.match(/type="radio"/g)).toHaveLength(6)
  expect(onboarding).toContain('What should neighbors call you?')
  expect(onboarding).toContain('for="display_name"')
  expect(onboarding).toContain('maxLength="60"')
  expect(onboarding).not.toContain('private@example.test')
  expect(onboarding).not.toContain('Main navigation')
})

it('puts the saved-invite card above the same sign-in form without exposing the invite or a signed-in header', () => {
  const invite = '11111111-1111-4111-8111-111111111111.' + 'a'.repeat(43)
  const markup = render(createElement(JoinPage), { route: '/join/:token', path: `/join/${invite}` })
  expect(markup).toContain('You&#x27;re invited')
  expect(markup).toContain('Someone shared a Communal Cache with you')
  expect(markup).toContain('Invite saved on this browser')
  expect(markup.indexOf('Invite saved on this browser')).toBeLessThan(markup.indexOf('<form'))
  expect(markup).toContain('Email me a sign-in link')
  expect(markup).not.toContain(invite)
  expect(markup).not.toContain('Main navigation')
})

it('keeps the magic landing scanner-safe and header-free even for an already signed-in caller', () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  const markup = render(createElement(MagicLinkPage), { path: '/auth/link', route: '/auth/link', me: { id: 'caller', email: 'private@example.test', display_name: 'Neighbor' } })
  expect(markup).toContain('Almost there')
  expect(markup).toContain('>Continue</button>')
  expect(markup).toContain('Opening this page does not use your link')
  expect(markup).toContain('Links work once and expire after 5 minutes')
  expect(markup).toContain('Link not working? Get a new one')
  expect(markup).not.toContain('Main navigation')
  expect(markup).not.toContain('private@example.test')
  expect(fetchMock).not.toHaveBeenCalled()
})
