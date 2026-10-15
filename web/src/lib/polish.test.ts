import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { CachePage } from '../pages/CachePage'
import { CacheSettingsPage } from '../pages/CacheSettingsPage'
import { HomePage } from '../pages/HomePage'
import { ItemEditorPage, ItemList, ItemPage } from '../pages/ItemPages'
import { JoinRequests } from '../pages/JoinRequests'
import { LoginForm } from '../pages/LoginPage'
import { OnboardingPage } from '../pages/OnboardingPage'
import { PushControls } from '../pages/PushControls'
import { RequestsPage } from '../pages/RequestsPage'
import { apiFetch, ApiError, errorMessage } from './api'

const id = '11111111-1111-4111-8111-111111111111'
const itemId = '22222222-2222-4222-8222-222222222222'
const cache = { id, name: 'Tools', owner_id: 'owner', requires_approval: true, invite_token: `${id}.${'a'.repeat(43)}`, members: [{ user_id: 'owner', display_name: 'Owner' }, { user_id: 'member', display_name: 'Neighbor' }] }
const item = { id: itemId, cache_id: id, owner_id: 'owner', owner_name: 'Owner', title: 'Mixer', description: null, is_consumable: false, quantity: null, photo_version: null, created_at: 1 }

function render(element: ReactElement, options: { route?: string; path?: string; errors?: unknown[][]; unavailable?: string[]; next?: string | null } = {}) {
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:8788' })
  vi.stubGlobal('sessionStorage', { getItem: () => null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  client.setQueryData(['me'], { id: 'owner', display_name: 'Owner', email: 'private@example.test' })
  client.setQueryData(['cache', id], cache)
  client.setQueryData(['item', id, itemId], item)
  client.setQueryData(['caches'], [])
  client.setQueryData(['items', id], [])
  client.setQueryData(['join-requests', id], [])
  client.setQueryData(['requests'], { pages: [{ requests: [], unavailable_cache_ids: options.unavailable ?? [], next_cursor: options.next ?? null }], pageParams: [null] })
  for (const key of options.errors ?? []) client.getQueryCache().build(client, { queryKey: key }).setState({ status: 'error', error: new ApiError(503, 'unavailable') })
  const page = createElement(Routes, null, createElement(Route, { path: options.route ?? '/', element }))
  const result = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, { initialEntries: [options.path ?? '/'] }, page) })))
  client.clear()
  return result
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('shows distinct empty and failed states for home, items and join queues, with error recovery controls', () => {
  expect(render(createElement(HomePage))).toContain('No caches yet')
  const homeError = render(createElement(HomePage), { errors: [['caches']] })
  expect(homeError).toContain('Previously loaded caches may be out of date')
  expect(homeError).toContain('Try caches again')
  expect(homeError).not.toContain('No caches yet')
  expect(render(createElement(ItemList, { cacheId: id }))).toContain('Nothing shared yet')
  const itemsError = render(createElement(ItemList, { cacheId: id }), { errors: [['items', id]] })
  expect(itemsError).toContain('role="alert"')
  expect(itemsError).toContain('Try items again')
  expect(itemsError).not.toContain('Nothing shared yet')
  expect(render(createElement(JoinRequests, { cacheId: id }))).toContain('No pending join requests')
  const joinError = render(createElement(JoinRequests, { cacheId: id }), { errors: [['join-requests', id]] })
  expect(joinError).toContain('Previously loaded join requests may be out of date')
  expect(joinError).not.toContain('No pending join requests')
})

it('never presents partial, paginated or failed aggregate lists as complete empty queues', () => {
  const empty = render(createElement(RequestsPage))
  expect(empty).toContain('No requests need your answer in the loaded caches.')
  expect(empty).not.toContain('may be incomplete')
  for (const options of [{ unavailable: ['cache'] }, { next: 'next' }, { errors: [['requests']] }]) {
    const partial = render(createElement(RequestsPage), options)
    expect(partial).toContain('No requests need your answer in the loaded caches. This list may be incomplete.')
    expect(partial).not.toContain('Refresh all requests')
  }
})

it('keeps unavailable cache/item/editor data out of mutation forms and offers retry', () => {
  const route = '/caches/:cacheId', path = `/caches/${id}`
  const cacheError = render(createElement(CachePage), { route, path, errors: [['cache', id]] })
  expect(cacheError).toContain('Try again')
  expect(cacheError).not.toContain('Owner settings')
  const itemOptions = { route: '/caches/:cacheId/items/:itemId', path: `${path}/items/${itemId}` }
  const itemError = render(createElement(ItemPage), { ...itemOptions, errors: [['item', id, itemId]] })
  expect(itemError).toContain('Try again')
  expect(itemError).not.toContain('Delete item')
  const editorError = render(createElement(ItemEditorPage, { editing: true }), { ...itemOptions, errors: [['item', id, itemId]] })
  expect(editorError).toContain('Try again')
  expect(editorError).not.toContain('item-title')
})

it('uses named native dialogs with a safe initial focus target, and labels every text input', () => {
  const markup = render(createElement(CacheSettingsPage), { route: '/caches/:cacheId/settings', path: `/caches/${id}/settings` })
  expect(markup).toContain('aria-labelledby="members-heading"')
  expect(markup).toContain('id="members-heading" tabindex="-1"')
  expect(markup).toContain('aria-labelledby="rotate-heading"')
  expect(markup).toContain('aria-labelledby="remove-member"')
  expect(markup.match(/autofocus=""/g)).toHaveLength(2)
  expect(markup).toContain('role="switch"')
  expect(markup).toContain('Approve new members')
  const home = render(createElement(HomePage))
  expect(home).toContain('for="cache-name"')
  expect(home).toContain('autofocus=""')
  const detail = render(createElement(ItemPage), { route: '/caches/:cacheId/items/:itemId', path: `/caches/${id}/items/${itemId}` })
  expect(detail).toContain('aria-labelledby="delete-item-heading"')
  expect(detail).toContain('autofocus=""')
  expect(detail).toContain('for="item-photo"')
  const editor = render(createElement(ItemEditorPage), { route: '/caches/:cacheId/items/new', path: `/caches/${id}/items/new` })
  expect(editor).toContain('for="item-title"')
  expect(editor).toContain('for="item-description"')
  expect(render(createElement(LoginForm))).toContain('for="email"')
  expect(render(createElement(OnboardingPage))).toContain('for="display_name"')
})

it('offers a recovery action for failed notification configuration without requesting permission', () => {
  const markup = render(createElement(PushControls, { userId: 'owner' }), { errors: [['config']] })
  expect(markup).toContain('Could not load notification configuration')
  expect(markup).toContain('Try notification configuration again')
  expect(markup).toContain('disabled=""')
})

it('renders bounded Retry-After seconds for write failures without automatic mutation retries', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '37' } }))
  let error: unknown
  try { await apiFetch('/api/caches/cache/join', { body: { secret: 'fixture' } }) } catch (caught) { error = caught }
  expect(error).toMatchObject({ status: 429, retryAfter: 37 })
  expect(errorMessage(error)).toContain('wait 37 seconds')
  expect(errorMessage(new ApiError(400, 'INVALID_OTP'))).toContain('most recent code')
  expect(errorMessage(new ApiError(429, 'rate_limited'))).toContain('wait a minute')
})
