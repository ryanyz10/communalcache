import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PixelHorizon } from '../components/PixelArt'
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

it('preserves phone geometry while repeating native-pixel terrain from 640px instead of stretching a viewBox', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  const markup = renderToStaticMarkup(createElement(PixelHorizon, { kind: 'houses', entries: [{ id: 'member', name: 'Ryan' }] }))
  expect(markup).toMatch(/class="cc-horizon-phone" width="100%" height="96" style="min-width:280px"/)
  expect(markup).toContain('cc-horizon-fluid')
  expect(markup).toMatch(/<pattern[^>]*patternUnits="userSpaceOnUse"[^>]*width="216"[^>]*height="60"/)
  expect(markup).toContain('cc-horizon-objects')
  expect(markup).not.toContain('viewBox="0 0 440 96"')
  expect(markup.match(/class="cc-walking-cat"/g)).toHaveLength(1)
  expect(css).toContain('.cc-horizon-fluid { display: none; }')
  const fluid = css.split('/* Tablet and larger layouts')[1]
  expect(fluid).toContain('@media (min-width: 640px)')
  expect(fluid).toContain('.cc-horizon .cc-horizon-phone { display: none; }')
  expect(fluid).toContain('height: calc(50 * var(--cc-pixel))')
  for (const [width,px] of [[1500,4],[2100,5],[2800,6],[3500,7]]) expect(fluid).toContain(`@container (min-width: ${width}px) { .cc-horizon-fluid, .cc-horizon .cc-walking-cat { --cc-pixel: ${px}px; } }`)
})

it('shares a fluid gutter/cap, readable prose and intrinsic grids across tablet through ultra-wide widths', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  expect(css).toContain('--cc-gutter: clamp(16px,4vw,96px)')
  expect(css).toContain('--cc-content-cap: 1920px')
  expect(css).toContain('width: min(calc(100% - 2 * var(--cc-gutter)),var(--cc-content-cap))')
  expect(css).toContain('max-inline-size: 72ch')
  expect(css).toContain('repeat(auto-fill,minmax(min(100%,clamp(220px,18vw,320px)),1fr))')
  expect(css).toContain('@container (min-width: 68rem)')
  expect(css).toContain('grid-template-columns: minmax(0,1fr) clamp(240px,18vw,320px)')
  expect(css).toContain('.cc-home, .cc-cache-page { width: 100%')
  expect(css).toContain('font-size: clamp(1.75rem,1.2rem + 1vw,3rem)')
  for (const width of [768,1024,1440,1920,2560,3840]) {
    const gutter = Math.min(96,Math.max(16,width*.04))
    const content = Math.min(width-gutter*2,1920)
    const minimum = Math.min(320,Math.max(220,width*.18))
    const gap = Math.min(28,Math.max(16,width*.016))
    const columns = Math.floor((content+gap)/(minimum+gap))
    expect(content).toBeGreaterThan(640)
    expect(columns).toBeGreaterThanOrEqual(3)
    expect(content).toBeLessThanOrEqual(1920)
  }
})

it('extends 449–639px backgrounds without widening the existing phone content or foreground scene', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  expect(css).toContain('@media (min-width: 449px) and (max-width: 639px)')
  expect(css).toContain('.cc-home, .cc-cache-page { max-width: none; padding-inline: 0; }')
  expect(css).toContain('display: block; width: 448px; max-width: 100%; margin-inline: auto; padding-inline: 16px')
  expect(css).toContain('.cc-horizon { width: 100vw; margin-inline: calc((100% - 100vw) / 2); }')
  expect(css).toContain('.cc-hero .cc-phone-scene { width: 448px; }')
  expect(css).toContain('.cc-auth .cc-phone-scene { width: 408px; }')
  expect(css).toContain('--cc-pixel: 2px; position: absolute; inset: 0; display: block; height: 96px')
  const markup = render(createElement(HomePage))
  expect(markup).toContain('cc-phone-scene')
  expect(markup).toContain('cc-phone-terrain')
})

it('uses a shared profile menu on phone and desktop rather than tabs or a Requests icon', () => {
  const markup = render(createElement(AppHeader), { path: '/requests', route: '/requests' })
  expect(markup).toContain('aria-label="Home"')
  expect(markup).toContain('hidden lg:inline lg:text-[17px]')
  expect(markup).toContain('aria-haspopup="menu"')
  expect(markup).toContain('aria-expanded="false"')
  expect(markup).toMatch(/<a(?=[^>]*href="\/requests")(?=[^>]*aria-current="page")(?=[^>]*role="menuitem")[^>]*>/)
  expect(markup).not.toContain('Desktop navigation')
  expect(markup).not.toContain('Main navigation')
  expect(markup).toContain('cc-header-content')
  expect(markup).not.toContain('lg:max-w-[1200px]')
  expect(markup).not.toContain('private@example.test')
})

it('keeps full-width cache cards at lg with create/invite sheets and no request sidebar', () => {
  const markup = render(createElement(HomePage))
  expect(markup).not.toContain('lg:grid-cols-[minmax(0,1fr)_340px]')
  expect(markup).toContain('cc-card-grid')
  expect(markup).toContain('cc-page cc-home')
  expect(markup).toContain('cc-hero-content')
  expect(markup).toContain('cc-content')
  expect(markup).toContain('hidden lg:flex lg:size-10')
  expect(markup).toContain('cc-sheet lg:w-[440px] lg:rounded-2xl lg:p-6')
  expect(markup).toContain('flex gap-3 lg:flex-row-reverse')
  expect(markup.match(/<dialog\b/g)).toHaveLength(2)
  expect(markup.match(/<form\b/g)).toHaveLength(2)
  expect(markup).toContain('Your items')
  expect(markup).toContain('href="/items"')
  expect(markup).toContain('See all')
})

it('uses wide-only breadcrumbs, Settings label and photo cards without duplicating item details or inventing pending chips', () => {
  const markup = render(createElement(CachePage), { route: '/caches/:cacheId', path: `/caches/${id}` })
  expect(markup).toContain('aria-label="Breadcrumb" class="hidden lg:flex')
  expect(markup).toContain('text-sm underline lg:hidden')
  expect(markup).toContain('class="hidden lg:inline">Settings')
  expect(markup).toContain('cc-card-grid')
  expect(markup).toContain('cc-page cc-cache-page')
  expect(markup).toContain('lg:aspect-[4/3]')
  expect(markup).toContain('lg:border-dashed')
  expect(markup).toContain('cc-cache-layout')
  expect(markup).toMatch(/<aside class="cc-cache-members hidden lg:mt-6 lg:block[^>]*aria-labelledby="cache-members-heading"/)
  expect(markup).toContain('Members · 2')
  expect(markup.match(/>Starter<\/h3>/g)).toHaveLength(1)
  expect(markup).not.toContain('>Pending</span>')
  const detail = render(createElement(ItemPage), { route: '/caches/:cacheId/items/:itemId', path: `/caches/${id}/items/${itemId}` })
  expect(detail).toContain('contents lg:mt-4 lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]')
  expect(detail).toContain('contents lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:block')
  expect(detail).toContain('hidden lg:block lg:aspect-[4/3]')
  expect(detail.match(/>Starter<\/h1>/g)).toHaveLength(1)
})

it('opens destructive controls with distinct global-delete and detach consequences', () => {
  const detail = render(createElement(ItemPage), { route: '/caches/:cacheId/items/:itemId', path: `/caches/${id}/items/${itemId}` })
  expect(detail).toContain('>Starter</h1>')
  expect(detail).toContain('Edit item')
  expect(detail).toContain('Upload photo')
  expect(detail).toContain('Save availability')
  expect(detail).toContain('for="unavailable-note"')
  expect(detail).toContain('not existing pending requests')
  expect(detail).toContain('Delete item')
  expect(detail).toContain('your library and every cache')
  expect(detail).toContain('Shown in')
  expect(detail).toContain('The item is removed from this cache only')
  expect(detail).toContain('Your library item, photos, stock and other caches are kept')
  expect(detail).not.toContain('Requests are being moved')
  expect(detail).toContain('Approve request')
  const cache = render(createElement(CachePage), { route: '/caches/:cacheId', path: `/caches/${id}` })
  expect(cache).toContain('+ Add item')
  expect(cache).not.toContain('Items are being moved')
})

it('adds a hidden sticky settings menu with only authorized sections and matching anchor ids', () => {
  const options = { route: '/caches/:cacheId/settings', path: `/caches/${id}/settings` }
  const owner = render(createElement(CacheSettingsPage), options)
  const nav = owner.match(/<nav aria-label="Settings sections"[^>]*>[\s\S]*?<\/nav>/)![0]
  expect(nav).toContain('class="hidden lg:sticky')
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

it('places outgoing requests on the right and account settings in two columns without duplicate actions', () => {
  const requests = render(createElement(RequestsPage))
  expect(requests).toContain('contents lg:grid lg:grid-cols-2')
  expect(requests).toContain('aria-label="Needs your answer"')
  expect(requests).toMatch(/<section[^>]*lg:col-start-2 lg:row-span-2 lg:row-start-1[^>]*aria-label="Your requests"/)
  expect(requests.match(/>Approve request from Priya<\/button>/g)).toHaveLength(1)
  const account = render(createElement(AccountPage))
  expect(account).toContain('class="cc-page"')
  expect(account).toContain('cc-account-layout')
  expect(account).toContain('contents lg:mt-6 lg:grid lg:grid-cols-2')
  expect(account).toContain('class="hidden lg:mb-3 lg:block lg:text-[17px] lg:font-semibold">Session')
  expect(account.match(/>Sign out<\/button>/g)).toHaveLength(1)
})

it('uses a hidden-until-lg brand panel and contents wrappers while retaining one sign-in form and email field', () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  const markup = render(createElement(LoginForm), { caller: null })
  expect(markup).toContain('cc-auth lg:grid lg:max-w-none lg:grid-cols-2')
  expect(markup).toContain('class="hidden lg:flex lg:min-h-dvh')
  expect(markup).toContain('class="cc-auth-pane contents lg:flex lg:min-h-dvh')
  expect(markup).toContain('<header class="lg:hidden">')
  expect(markup).toContain('Hand it off in person')
  expect(markup).toContain('cc-auth-form')
  expect(markup).toContain('cc-horizon-tall')
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  expect(css).toContain('max-width: 28rem')
  expect(css).toContain('height: clamp(240px,42vh,480px)')
  expect(markup.match(/<form\b/g)).toHaveLength(1)
  expect(markup.match(/type="email"/g)).toHaveLength(1)
  expect(fetchMock).not.toHaveBeenCalled()
})
