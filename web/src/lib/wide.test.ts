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
import { ItemPage } from '../pages/ItemPage'
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
  client.setQueryData(['requests', 'incoming'], { pages: [{ requests: options.caller && options.caller !== 'owner' ? [] : [request], unavailable_cache_ids: [], next_cursor: null }], pageParams: [null] })
  const page = createElement(Routes, null, createElement(Route, { path: options.route ?? '/', element }))
  const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, { initialEntries: [options.path ?? '/'] }, page) })))
  client.clear()
  return markup
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('retains shared fluid page sizing and current Home/cache layouts without retired scenery', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  for (const old of ['cc-horizon', 'cc-walking-cat', 'cc-box-lid', '--cc-pixel']) expect(css).not.toContain(old)
  expect(css).toContain('--cc-gutter: clamp(16px,3.125vw,96px)')
  expect(css).toContain('--cc-content-cap: 1920px')
  expect(css).toContain('width: min(calc(100% - 2 * var(--cc-gutter)),var(--cc-content-cap))')
  expect(css).toContain('max-inline-size: 72ch')
  const home = render(createElement(HomePage))
  expect(home).toContain('class="organic-home"')
  expect(home).toContain('class="cc-home-boxes"')
  expect(home).not.toMatch(/cc-horizon|cc-phone-terrain|data-opening/)
  const cache = render(createElement(CachePage), { route: '/caches/:cacheId', path: `/caches/${id}` })
  expect(cache).toContain('class="cc-contents-layout"')
  expect(cache).toContain('cc-member-list')
})

it('uses one visible save/cancel pair per editor breakpoint and keeps the drawer body scrollable', () => {
  const css = readFileSync(new URL('../items.css', import.meta.url), 'utf8')
  expect(css).toContain('.cc-item-editor-desktop-actions {\n  display: none;')
  expect(css).toContain('  .cc-item-editor-phone {\n    display: none;')
  expect(css).toContain('  .cc-item-editor-desktop-actions {\n    display: flex;')
  expect(css).toContain('max-width: 560px')
  expect(css).toContain('max-height: calc(var(--cc-editor-height,100dvh) * .92)')
  expect(css).toContain('.cc-item-editor-body {\n  min-height: 0;\n  overflow-y: auto;')
  for (const old of ['organic-item-editor','cc-item-editor-nav','cc-item-form-embedded','cc-item-save-actions']) expect(css).not.toContain(old)
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

it('preserves create/invite sheets and library entry in the labelled-box Home', () => {
  const markup = render(createElement(HomePage))
  for (const text of ['cc-home-boxes', 'organic-home', 'Your things', 'Your asks', 'See all', 'href="/items"']) expect(markup).toContain(text)
  expect(markup).toContain('cc-invite-paste')
  expect(markup).toContain('cc-new-cache')
  expect(markup.match(/<dialog\b/g)).toHaveLength(3)
  expect(markup.match(/<form\b/g)).toHaveLength(2)
  expect(markup).toContain('cc-labelled-cache')
})

it('retains cache breadcrumbs, members, owner controls and one copy of each item detail', () => {
  const markup = render(createElement(CachePage), { route: '/caches/:cacheId', path: `/caches/${id}` })
  expect(markup).toContain('aria-label="Your caches"')
  expect(markup).toContain('aria-label="Cache settings"')
  expect(markup).toContain('cc-contents-layout')
  expect(markup).toContain('cc-member-list')
  expect(markup).toContain('2 neighbors')
  expect(markup.match(/>Starter<\/strong>/g)).toHaveLength(1)
  const detail = render(createElement(ItemPage), { route: '/caches/:cacheId/items/:itemId', path: `/caches/${id}/items/${itemId}` })
  expect(detail.match(/>Starter<\/h1>/g)).toHaveLength(1)
  for (const text of ['Edit item', 'Upload photo', 'Save availability', 'for="unavailable-note"', 'not existing pending requests', 'Delete item', 'your library and every cache', 'Shown in', 'Approve request']) expect(detail).toContain(text)
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

it('keeps current request and Account layouts and actions', () => {
  const requests = render(createElement(RequestsPage))
  expect(requests).toContain('aria-label="Needs your answer"')
  expect(requests).toContain('aria-label="Your asks"')
  expect(requests.match(/aria-label="Approve request from Priya"/g)).toHaveLength(1)
  const account = render(createElement(AccountPage))
  expect(account).toContain('cc-account-layout')
  expect(account).toContain('cc-profile-label')
  expect(account).toContain('cc-account-settings')
  expect(account.match(/>Sign out<\/button>/g)).toHaveLength(1)
})

it('retains one native sign-in form and email field after removing the decorative strip', () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  const markup = render(createElement(LoginForm), { caller: null })
  expect(markup).toContain('cc-auth-page cc-auth-split cc-signin')
  expect(markup).toContain('cc-auth-form')
  expect(markup).toContain('hand it off in person')
  expect(markup).not.toMatch(/cc-horizon|cc-walking-cat/)
  expect(markup.match(/<form\b/g)).toHaveLength(1)
  expect(markup.match(/type="email"/g)).toHaveLength(1)
  expect(fetchMock).not.toHaveBeenCalled()
})
