import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { ItemEditorPage } from '../pages/ItemEditorPage'
import { ItemPage } from '../pages/ItemPage'
import { CachePage } from '../pages/CachePage'
import { ShownIn } from '../pages/ShownIn'
import { apiFetch, ApiError, errorMessage } from './api'
import { libraryItemQuery, type Item } from './items'

const cacheId = '11111111-1111-4111-8111-111111111111'
const item: Item = { id: '22222222-2222-4222-8222-222222222222', cache_id: cacheId, owner_id: 'owner', owner_name: 'Neighbor', title: 'Sugar', description: 'For baking', is_consumable: true, quantity: 0, created_at: 1, photo_version: null }

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function render(page: 'list' | 'detail' | 'add' | 'edit', options: { owner?: boolean; item?: Item; list?: 'empty' | 'error' | 'loading' } = {}) {
  const selected = options.item ?? item
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  client.setQueryData(['me'], { id: options.owner === false ? 'member' : 'owner', display_name: 'Neighbor', email: 'private@example.test' })
  client.setQueryData(['cache', cacheId], { id: cacheId, name: 'Tools', owner_id: 'owner', requires_approval: false, invite_token: `${cacheId}.${'A'.repeat(43)}`, members: [{ user_id: 'owner', display_name: 'Neighbor', attached_item_count: 1 }, { user_id: 'member', display_name: 'Member', attached_item_count: 0 }] })
  client.setQueryData(['join-requests', cacheId], [])
  client.setQueryData(['item', cacheId, item.id], selected)
  if (options.list === 'error') client.getQueryCache().build(client, { queryKey: ['items', cacheId] }).setState({ status: 'error', error: new ApiError(503, 'internal_error') })
  else if (options.list !== 'loading') client.setQueryData(['items', cacheId], options.list === 'empty' ? [] : [selected])
  const path = page === 'list' ? '/caches/:cacheId' : page === 'add' ? '/caches/:cacheId/items/new' : '/caches/:cacheId/items/:itemId'
  const entry = page === 'list' ? `/caches/${cacheId}` : page === 'add' ? `/caches/${cacheId}/items/new` : `/caches/${cacheId}/items/${item.id}`
  const element = page === 'list' ? createElement(CachePage) : page === 'detail' ? createElement(ItemPage) : createElement(ItemEditorPage, { editing: page === 'edit' })
  const routes = createElement(Routes, null, createElement(Route, { path, element }))
  const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, { initialEntries: [entry] }, routes) })))
  client.clear()
  return markup
}

it('lists routed cache contents with zero stock, kind filters, owner names and cache-scoped links', () => {
  const list = render('list', { owner: false })
  expect(list).toContain('Contents')
  expect(list).toContain('Sugar')
  expect(list).toContain('Neighbor')
  expect(list).toContain('0 to give')
  expect(render('list', { item: { ...item, quantity: 8, available_quantity: 5 } })).toContain('5 to give')
  expect(list).toContain(`/caches/${cacheId}/items/${item.id}`)
  expect(list).toContain('>+ Add item</button>')
  expect(list).not.toContain('private@example.test')
  const reusable = render('list', { item: { ...item, is_consumable: false, quantity: null } })
  expect(reusable).toContain('To lend')
  expect(reusable).toContain('Available')
})

it('distinguishes empty, unavailable and loading item lists', () => {
  expect(render('list', { list: 'empty' })).toContain('Nothing in here yet')
  const error = render('list', { list: 'error' })
  expect(error).toContain('role="alert"')
  expect(error).toContain('Try again')
  expect(error).toContain('Couldn&#x27;t open this box')
  expect(error).not.toContain('Nothing in here yet')
  const loading = render('list', { list: 'loading' })
  expect(loading).toContain('role="status" class="sr-only">Loading items…')
  expect(loading).toContain('cc-skeleton-cache-contents')
  expect(loading).not.toContain('Nothing in here yet')
})

it('shows item details to members but edit, upload and confirmed delete controls only to the item owner', () => {
  const owner = render('detail')
  expect(owner).toContain('Sugar')
  expect(owner).toContain('For baking')
  expect(owner).toContain('<dt>From</dt>')
  expect(owner).toContain('0 to give right now')
  expect(owner).toContain(`/caches/${cacheId}/items/${item.id}/edit`)
  const member = render('detail', { owner: false })
  expect(member).not.toContain('Edit item')
  expect(member).not.toContain('Upload photo')
  expect(member).not.toContain('Delete item')
  expect(member).not.toContain('Shown in')
  expect(owner).toContain('Delete item')
  expect(owner).toContain('Shown in')
  expect(owner).toContain('your library and every cache')
  expect(owner).toContain('Confirm deletion')
  expect(owner).toContain('Neighbors with pending requests will be notified')
  expect(owner).toContain('Upload photo')
  expect(owner).toContain('accept="image/jpeg,image/png,image/webp"')
})

it('renders labeled create/edit forms with immutable type and nullable reusable stock', () => {
  const add = render('add')
  expect(add).toContain('New item')
  expect(add).toContain('for="item-title"')
  expect(add).toContain('for="item-description"')
  expect(add).toContain('type="radio"')
  expect(add).toContain('Lend it')
  expect(add).toContain('Give it away')
  expect(add).toContain('Optional. Without one, the tile shows the name.')
  expect(add).toContain('>Save</button>')
  expect(add).not.toContain('item-quantity')
  expect(add).not.toContain('owner_id')
  const edit = render('edit')
  expect(edit).toContain('value="Sugar"')
  expect(edit).toContain('For baking')
  expect(edit).toContain('Item type cannot be changed')
  expect(edit).not.toContain('type="checkbox"')
  expect(edit).toContain('min="0" max="9999" step="1"')
  expect(edit).toContain('value="0"')
  expect(edit).toContain('>Save</button>')
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

it('renders photos through same-origin authorized routes in lists and details, with owner replacement controls', () => {
  const photographed = { ...item, photo_version: 'photo-version' }
  for (const page of ['list', 'detail'] as const) {
    const markup = render(page, { item: photographed })
    expect(markup).toContain(`/api/caches/${cacheId}/items/${item.id}/photo?v=photo-version`)
    expect(markup).toContain(page==='detail'?'alt="Photo of Sugar"':'alt=""')
    expect(markup).not.toContain('blob:')
    expect(markup).not.toContain('r2.dev')
    expect(markup).not.toContain('Authorization')
  }
  expect(render('detail', { item: photographed })).toContain('Replace photo')
  expect(render('detail', { item: photographed, owner: false })).not.toContain('Upload photo')
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

it('defines only the account-scoped private item key and exact cookie-auth path', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ...item, cache_id: null, caches: [], pending_count: 0 }))
  const query = libraryItemQuery('owner', item.id)
  expect(query.queryKey).toEqual(['library-item', 'owner', item.id])
  expect(libraryItemQuery(undefined, item.id).queryKey).toEqual(['library-item', undefined, item.id])
  expect(Object.keys(query).sort()).toEqual(['queryFn', 'queryKey'])
  await query.queryFn()
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/me/items/${item.id}`, expect.objectContaining({ method: 'GET', credentials: 'same-origin', body: undefined }))
})

it.each([
  ['private detail', false, false, true], ['cache detail', true, false, true],
  ['private edit', false, true, true], ['cache edit', true, true, true],
  ['private create', false, true, false], ['cache create', true, true, false],
] as const)('preserves exact keys, paths and disabled reads for %s', async (_label, inCache, editor, editing) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['me'], { id: 'owner', display_name: 'Neighbor' })
  const prefix = inCache ? `/caches/${cacheId}` : ''
  const path = `${prefix}/items/${item.id}`
  const route = `${inCache ? '/caches/:cacheId' : ''}/items/:itemId`
  const element = editor ? createElement(ItemEditorPage, { editing }) : createElement(ItemPage)
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null, createElement(Route, { path: route, element }))) })))
  const key = inCache ? ['item', cacheId, item.id] : ['library-item', 'owner', item.id]
  const detail = client.getQueryCache().find({ queryKey: key, exact: true })!
  const cache = client.getQueryCache().find({ queryKey: ['cache', inCache ? cacheId : undefined], exact: true })!
  expect(detail.options).toMatchObject({ enabled: !editor || editing, retry: false })
  expect(cache.options).toMatchObject({ enabled: inCache, retry: false })
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(item))
  const stops = [detail, cache].map(query => new QueryObserver(client, { ...query.options, queryKey: query.queryKey }).subscribe(() => {}))
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(Number(!editor || editing) + Number(inCache)))
  expect(fetch.mock.calls.map(call => call[0]).sort()).toEqual([
    ...(!editor || editing ? [inCache ? `/api/caches/${cacheId}/items/${item.id}` : `/api/me/items/${item.id}`] : []),
    ...(inCache ? [`/api/caches/${cacheId}`] : []),
  ].sort())
  stops.forEach(stop => stop()); client.clear()
})

it.each(['detail', 'edit', 'sharing'] as const)('makes zero item/cache requests in unnamed and signed-out %s contexts', async page => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(item))
  for (const me of [null, { id: 'owner', display_name: null }]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['me'], me)
    const element = page === 'detail' ? createElement(ItemPage) : page === 'edit' ? createElement(ItemEditorPage, { editing: true }) : createElement(ShownIn, { item })
    const children = createElement(MemoryRouter, { initialEntries: [`/caches/${cacheId}/items/${item.id}`] }, createElement(Routes, null, createElement(Route, { path: '/caches/:cacheId/items/:itemId', element })))
    renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children })))
    const queries = client.getQueryCache().getAll().filter(query => query.queryKey[0] !== 'me')
    expect(queries.length).toBeGreaterThan(0)
    for (const query of queries) expect(query.options).toMatchObject({ enabled: false })
    const stops = queries.map(query => new QueryObserver(client, { ...query.options, queryKey: query.queryKey }).subscribe(() => {}))
    await Promise.resolve()
    expect(queries.every(query => query.state.fetchStatus === 'idle')).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    stops.forEach(stop => stop()); client.clear()
  }
})

it('uses separate private global-delete and attachment-detach routes without choosing an owner', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
  await apiFetch(`/api/me/items/${item.id}`, { method: 'DELETE' })
  await apiFetch(`/api/me/items/${item.id}/attachments/${cacheId}`, { method: 'DELETE' })
  expect(fetchMock.mock.calls.map(call=>call[0])).toEqual([`/api/me/items/${item.id}`,`/api/me/items/${item.id}/attachments/${cacheId}`])
  expect(fetchMock.mock.calls.every(call=>call[1]?.method==='DELETE' && call[1]?.credentials==='same-origin' && call[1]?.body===undefined)).toBe(true)
})
