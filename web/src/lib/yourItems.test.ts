import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { HomePage } from '../pages/HomePage'
import { YourItems } from '../pages/YourItems'
import { ApiError, apiFetch } from './api'
import type { OwnedItem, OwnedItemsPage } from './items'

const id = '11111111-1111-4111-8111-111111111111'
const row: OwnedItem = { id: 'item', cache_id: id, cache_name: 'Maple Street', owner_id: 'caller', title: 'Starter', description: null, is_consumable: true, quantity: 5, created_at: 1, photo_version: 'version', pending_request_count: 2 }
function render(options: { items?: OwnedItem[]; unavailable?: string[]; next?: string | null; loading?: boolean; error?: boolean; home?: boolean; profileIncomplete?: boolean } = {}) {
  vi.stubGlobal('sessionStorage', { getItem: () => null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  if (!options.loading) {
    const data: OwnedItemsPage = { items: options.items ?? [row], unavailable_cache_ids: options.unavailable ?? [], next_cursor: options.next ?? null }
    client.setQueryData(['my-items'], { pages: [data], pageParams: [null] })
  }
  if (options.error) client.getQueryCache().build(client, { queryKey: ['my-items'] }).setState({ status: 'error', error: new ApiError(503, 'unavailable') })
  client.setQueryData(['me'], { id: 'caller', display_name: options.profileIncomplete ? null : 'Neighbor', email: 'private@example.test' })
  client.setQueryData(['caches'], [{ id, name: 'Maple Street' }])
  const page = createElement(options.home ? HomePage : YourItems)
  const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, null, page) })))
  client.clear()
  return markup
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('renders own-item links, cache names, zero stock, reusable type, pending counts and authenticated photo routes', () => {
  const tool = { ...row, id: 'tool', cache_name: 'Garden Club', title: 'Ladder', is_consumable: false, quantity: null, photo_version: null, pending_request_count: 0 }
  const emptyStock = { ...row, id: 'empty', title: 'Seeds', quantity: 0, photo_version: null, pending_request_count: 0 }
  const markup = render({ items: [row, tool, emptyStock] })
  expect(markup).toContain('Your items')
  expect(markup).toContain('Maple Street · 0 in stock')
  expect(markup).toContain('Garden Club · Reusable')
  expect(markup).toContain('2 pending requests')
  expect(markup).toContain(`/caches/${id}/items/item`)
  expect(markup).toContain(`/api/caches/${id}/items/item/photo?v=version`)
  expect(markup).toContain('lg:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]')
  for (const absent of ['private@example.test', 'owner_name', 'photo_path', 'r2.dev', '0 pending requests']) expect(markup).not.toContain(absent)
})

it('uses a loading skeleton and explicit error recovery rather than a misleading empty state', () => {
  const loading = render({ loading: true })
  expect(loading).toContain('aria-busy="true"')
  expect(loading).toContain('Loading your items')
  expect(loading).not.toContain('Open a cache to add something')
  const error = render({ error: true, items: [] })
  expect(error).toContain('role="alert"')
  expect(error).toContain('Try your items again')
  expect(error).not.toContain('No items in your discovered caches')
  const stale = render({ error: true })
  expect(stale).toContain('Previously loaded items may be out of date')
  expect(stale).toContain('Starter')
})

it('offers an honest empty hint and cache continuation/partial failure recovery', () => {
  const empty = render({ items: [] })
  expect(empty).toContain('Open a cache to add something to share')
  const partial = render({ items: [], unavailable: ['failed-cache'], next: 'next-cache' })
  expect(partial).toContain('This list is incomplete')
  expect(partial).toContain('This list may be incomplete')
  expect(partial).toContain('Try unavailable caches again')
  expect(partial).toContain('Load more item caches')
  expect(partial).not.toContain('No items in your discovered caches yet')
})

it('places the section below caches on Home without affecting the existing onboarding gate', () => {
  const home = render({ home: true })
  expect(home.indexOf('Your caches')).toBeLessThan(home.indexOf('Your items'))
  expect(home).toContain('Starter')
  expect(home).not.toContain('preview-heading')
  const incomplete = render({ home: true, profileIncomplete: true })
  expect(incomplete).toContain('What should neighbors call you?')
  expect(incomplete).not.toContain('Your items')
})

it('reads the caller-scoped endpoint and cursor with cookies and no supplied owner identity', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ items: [], unavailable_cache_ids: [], next_cursor: null }))
  await apiFetch(`/api/me/items?after=${id}`)
  expect(fetchMock).toHaveBeenCalledWith(`/api/me/items?after=${id}`, expect.objectContaining({ method: 'GET', credentials: 'same-origin', body: undefined }))
  expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('owner_id')
})
