import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { ItemEditorPage, ItemList, ItemPage } from '../pages/ItemPages'
import { apiFetch, ApiError, errorMessage } from './api'
import type { Item } from './items'

const cacheId = '11111111-1111-4111-8111-111111111111'
const item: Item = { id: '22222222-2222-4222-8222-222222222222', cache_id: cacheId, owner_id: 'owner', owner_name: 'Neighbor', title: 'Sugar', description: 'For baking', is_consumable: true, quantity: 0, created_at: 1 }

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function render(page: 'list' | 'detail' | 'add' | 'edit', options: { owner?: boolean; item?: Item; list?: 'empty' | 'error' | 'loading' } = {}) {
  const selected = options.item ?? item
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  client.setQueryData(['me'], { id: options.owner === false ? 'member' : 'owner', display_name: 'Neighbor', email: 'private@example.test' })
  client.setQueryData(['cache', cacheId], { id: cacheId, name: 'Tools' })
  client.setQueryData(['item', cacheId, item.id], selected)
  if (options.list === 'error') client.getQueryCache().build(client, { queryKey: ['items', cacheId] }).setState({ status: 'error', error: new ApiError(503, 'internal_error') })
  else if (options.list !== 'loading') client.setQueryData(['items', cacheId], options.list === 'empty' ? [] : [selected])
  const path = page === 'add' ? '/caches/:cacheId/items/new' : '/caches/:cacheId/items/:itemId'
  const entry = page === 'add' ? `/caches/${cacheId}/items/new` : `/caches/${cacheId}/items/${item.id}`
  const element = page === 'list' ? createElement(ItemList, { cacheId }) : page === 'detail' ? createElement(ItemPage) : createElement(ItemEditorPage, { editing: page === 'edit' })
  const routes = createElement(Routes, null, createElement(Route, { path, element }))
  const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, { initialEntries: [entry] }, routes) })))
  client.clear()
  return markup
}

it('lists shared things with zero stock, reusable labels, owner names and cache-scoped links', () => {
  const list = render('list')
  expect(list).toContain('Shared things')
  expect(list).toContain('Sugar')
  expect(list).toContain('Neighbor')
  expect(list).toContain('0 in stock')
  expect(list).toContain(`/caches/${cacheId}/items/${item.id}`)
  expect(list).toContain(`/caches/${cacheId}/items/new`)
  expect(list).not.toContain('private@example.test')
  expect(render('list', { item: { ...item, is_consumable: false, quantity: null } })).toContain('Reusable')
})

it('distinguishes empty, unavailable and loading item lists', () => {
  expect(render('list', { list: 'empty' })).toContain('Nothing shared yet')
  const error = render('list', { list: 'error' })
  expect(error).toContain('role="alert"')
  expect(error).toContain('Try items again')
  expect(error).not.toContain('Nothing shared yet')
  expect(render('list', { list: 'loading' })).toContain('Loading items')
})

it('shows item details to members but edit controls only to the item owner, with no deletion or upload', () => {
  const owner = render('detail')
  expect(owner).toContain('Sugar')
  expect(owner).toContain('For baking')
  expect(owner).toContain('Shared by Neighbor')
  expect(owner).toContain('0 in stock')
  expect(owner).toContain(`/caches/${cacheId}/items/${item.id}/edit`)
  expect(render('detail', { owner: false })).not.toContain('Edit item')
  expect(owner).not.toContain('Delete')
  expect(owner).not.toContain('Upload')
})

it('renders labeled create/edit forms with immutable type and nullable reusable stock', () => {
  const add = render('add')
  expect(add).toContain('Add an item')
  expect(add).toContain('for="item-title"')
  expect(add).toContain('for="item-description"')
  expect(add).toContain('type="checkbox"')
  expect(add).not.toContain('item-quantity')
  expect(add).not.toContain('owner_id')
  const edit = render('edit')
  expect(edit).toContain('value="Sugar"')
  expect(edit).toContain('For baking')
  expect(edit).toContain('Item type cannot be changed')
  expect(edit).not.toContain('type="checkbox"')
  expect(edit).toContain('min="0" max="9999" step="1"')
  expect(edit).toContain('value="0"')
  expect(edit).toContain('Save item')
  expect(render('edit', { item: { ...item, is_consumable: false, quantity: null } })).not.toContain('item-quantity')
})

it('escapes user content and explains field errors and reservation conflicts', () => {
  const detail = render('detail', { item: { ...item, title: '<script>alert(1)</script>', description: '<img src=x>' } })
  expect(detail).not.toContain('<script>')
  expect(detail).toContain('&lt;script&gt;')
  expect(errorMessage(new ApiError(400, 'invalid_title'))).toContain('120')
  expect(errorMessage(new ApiError(400, 'invalid_description'))).toContain('2000')
  expect(errorMessage(new ApiError(400, 'invalid_quantity'))).toContain('0 to 9999')
  expect(errorMessage(new ApiError(400, 'immutable_is_consumable'))).toContain('cannot be changed')
  expect(errorMessage(new ApiError(409, 'quantity_reserved'))).toContain('pending requests')
})

it('sends cookie-auth item CRUD to nested routes, without owner assignment or editable type', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(item))
  const path = `/api/caches/${cacheId}/items`
  await apiFetch(path)
  await apiFetch(path, { method: 'POST', body: { title: 'Sugar', is_consumable: true, quantity: 0, description: null } })
  await apiFetch(`${path}/${item.id}`)
  await apiFetch(`${path}/${item.id}`, { method: 'PATCH', body: { title: 'Brown sugar', description: null, quantity: 5 } })
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual([path, path, `${path}/${item.id}`, `${path}/${item.id}`])
  expect(fetchMock.mock.calls.every(call => call[1]?.credentials === 'same-origin')).toBe(true)
  expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('owner_id')
  expect(JSON.parse(fetchMock.mock.calls[3][1]?.body as string)).not.toHaveProperty('is_consumable')
})
