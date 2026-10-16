import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { AppHeader } from '../components/AppHeader'
import { HomePage } from '../pages/HomePage'
import { CachePage } from '../pages/CachePage'
import { CacheSettingsPage } from '../pages/CacheSettingsPage'
import { ItemPage } from '../pages/ItemPages'
import { RequestsPage } from '../pages/RequestsPage'
import { AccountPage } from '../pages/AccountPage'
import { LoginForm } from '../pages/LoginPage'
import type { ItemRequest } from './requests'

const id = '11111111-1111-4111-8111-111111111111'
const itemId = '22222222-2222-4222-8222-222222222222'
const cache = { id, name: 'Maple Street', owner_id: 'owner', requires_approval: true, invite_token: `${id}.${'a'.repeat(43)}`, members: [{ user_id: 'owner', display_name: 'Ryan' }, { user_id: 'member', display_name: 'Priya' }] }
const item = { id: itemId, cache_id: id, owner_id: 'owner', owner_name: 'Ryan', title: 'Starter', description: 'Bring a jar.', is_consumable: true, quantity: 5, photo_version: null, created_at: 1 }
const request: ItemRequest = { id: 'incoming', cache_id: id, cache_name: cache.name, item_id: itemId, item_title: item.title, owner_id: 'owner', owner_name: 'Ryan', requester_id: 'member', requester_name: 'Priya', quantity: 1, status: 'pending', decision_reason: null, decided_at: null, created_at: 1 }
function render(element: ReactElement, options: { caller?: string | null; path?: string; route?: string } = {}) {
  vi.stubGlobal('location', { origin: 'https://communalcache.com' })
  vi.stubGlobal('sessionStorage', { getItem: () => null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['me'], options.caller === null ? null : { id: options.caller ?? 'owner', display_name: 'Ryan', email: 'private@example.test' })
  client.setQueryData(['cache', id], cache)
  client.setQueryData(['caches'], [{ id, name: cache.name }])
  client.setQueryData(['items', id], [item])
  client.setQueryData(['item', id, itemId], item)
  client.setQueryData(['item-requests', id, itemId], [request])
  client.setQueryData(['join-requests', id], [{ user_id: 'applicant', display_name: 'Lee', created_at: 1 }])
  client.setQueryData(['requests'], { pages: [{ requests: [request], unavailable_cache_ids: [], next_cursor: null }], pageParams: [null] })
  const page = createElement(Routes, null, createElement(Route, { path: options.route ?? '/', element }))
  const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, { initialEntries: [options.path ?? '/'] }, page) })))
  client.clear()
  return markup
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('removes pixel scenery while retaining readable fluid fallback layouts until each page redesign', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  for (const old of ['cc-horizon', 'cc-walking-cat', 'cc-box-lid', '--cc-pixel']) expect(css).not.toContain(old)
  expect(css).toContain('--cc-gutter: clamp(16px,3.125vw,96px)')
  expect(css).toContain('--cc-content-cap: 1920px')
  expect(css).toContain('width: min(calc(100% - 2 * var(--cc-gutter)),var(--cc-content-cap))')
  expect(css).toContain('max-inline-size: 72ch')
  expect(css).toContain('repeat(auto-fill,minmax(min(100%,clamp(220px,18vw,320px)),1fr))')
  expect(css).toContain('@container (min-width: 68rem)')
  expect(css).toContain('grid-template-columns: minmax(0,1fr) clamp(240px,18vw,320px)')
  expect(css).toContain('.cc-home, .cc-cache-page { width: 100%')
  expect(render(createElement(HomePage))).not.toMatch(/cc-horizon|cc-phone-terrain|data-opening/)
})

it('uses top tabs and bottom links instead of the old account menu without exposing private email', () => {
  const markup = render(createElement(AppHeader), { path: '/requests', route: '/requests' })
  expect(markup).toContain('aria-label="Home"')
  expect(markup).toContain('aria-label="Desktop navigation"')
  expect(markup).toContain('aria-label="Mobile navigation"')
  expect(markup).toMatch(/<a(?=[^>]*href="\/requests")(?=[^>]*aria-current="page")[^>]*>/)
  expect(markup).toContain('aria-label="Account"')
  expect(markup).toContain('cc-header-content')
  expect(markup).not.toMatch(/role="menu|aria-haspopup="menu|private@example.test/)
})

it('preserves cache create/invite sheets and library entry without doing the later Home screen redesign', () => {
  const markup = render(createElement(HomePage))
  for (const text of ['cc-card-grid', 'cc-page cc-home', 'cc-hero-content', 'cc-content', 'Your items', 'See all', 'href="/items"']) expect(markup).toContain(text)
  expect(markup).toContain('cc-sheet lg:w-[440px] lg:rounded-2xl lg:p-6')
  expect(markup).toContain('flex gap-3 lg:flex-row-reverse')
  expect(markup.match(/<dialog\b/g)).toHaveLength(2)
  expect(markup.match(/<form\b/g)).toHaveLength(2)
  expect(markup).toContain('cc-box cc-box-compact')
})

it('retains cache breadcrumbs, members, owner controls and one copy of each item detail', () => {
  const markup = render(createElement(CachePage), { route: '/caches/:cacheId', path: `/caches/${id}` })
  expect(markup).toContain('aria-label="Breadcrumb" class="hidden lg:flex')
  expect(markup).toContain('aria-label="Cache settings"')
  expect(markup).toContain('cc-cache-layout')
  expect(markup).toContain('cc-cache-members')
  expect(markup).toContain('Members · 2')
  expect(markup.match(/>Starter<\/h3>/g)).toHaveLength(1)
  const detail = render(createElement(ItemPage), { route: '/caches/:cacheId/items/:itemId', path: `/caches/${id}/items/${itemId}` })
  expect(detail.match(/>Starter<\/h1>/g)).toHaveLength(1)
  for (const text of ['Edit item', 'Upload photo', 'Save availability', 'for="unavailable-note"', 'not existing pending requests', 'Delete item', 'your library and every cache', 'Shown in', 'The item is removed from this cache only', 'Your library item, photos, stock and other caches are kept', 'Approve request']) expect(detail).toContain(text)
  expect(detail).not.toContain('Requests are being moved')
  expect(markup).toContain('+ Add item')
})

it('retains settings section links only for authorized roles', () => {
  const options = { route: '/caches/:cacheId/settings', path: `/caches/${id}/settings` }
  const owner = render(createElement(CacheSettingsPage), options)
  const nav = owner.match(/<nav aria-label="Settings sections"[^>]*>[\s\S]*?<\/nav>/)![0]
  for (const section of ['join-requests', 'members', 'invite', 'cache']) {
    expect(nav).toContain(`href="#${section}"`)
    expect(owner).toContain(`id="${section}"`)
  }
  const member = render(createElement(CacheSettingsPage), { ...options, caller: 'member' })
  expect(member).toContain('href="#members"')
  expect(member).toContain('href="#invite"')
  expect(member).not.toContain('href="#join-requests"')
  expect(member).not.toContain('href="#cache"')
})

it('keeps existing request and Account actions while their screen layouts await later PRs', () => {
  const requests = render(createElement(RequestsPage))
  expect(requests).toContain('aria-label="Needs your answer"')
  expect(requests).toContain('aria-label="Your requests"')
  expect(requests.match(/>Approve request from Priya<\/button>/g)).toHaveLength(1)
  const account = render(createElement(AccountPage))
  expect(account).toContain('cc-account-layout')
  expect(account).toContain('contents lg:mt-6 lg:grid lg:grid-cols-2')
  expect(account.match(/>Sign out<\/button>/g)).toHaveLength(1)
})

it('retains one native sign-in form and email field after removing the decorative strip', () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  const markup = render(createElement(LoginForm), { caller: null })
  expect(markup).toContain('cc-auth lg:grid lg:max-w-none lg:grid-cols-2')
  expect(markup).toContain('cc-auth-form')
  expect(markup).toContain('Hand it off in person')
  expect(markup).not.toMatch(/cc-horizon|cc-walking-cat/)
  expect(markup.match(/<form\b/g)).toHaveLength(1)
  expect(markup.match(/type="email"/g)).toHaveLength(1)
  expect(fetchMock).not.toHaveBeenCalled()
})
