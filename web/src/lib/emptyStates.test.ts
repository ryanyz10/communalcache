import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { HomePage } from '../pages/HomePage'
import { CachePage } from '../pages/CachePage'
import { CacheSettingsPage } from '../pages/CacheSettingsPage'
import { LibraryPage } from '../pages/LibraryPage'
import { RequestsPage } from '../pages/RequestsPage'
import { ItemRequests } from '../pages/ItemRequests'
import { JoinRequests } from '../pages/JoinRequests'
import { AddItemSheet } from '../pages/AddItemSheet'
import { ShownIn } from '../pages/ShownIn'
import { ItemForm } from '../pages/ItemForm'
import { AdminPage } from '../pages/AdminPage'
import type { LibraryItem } from './items'

const cacheId = '11111111-1111-4111-8111-111111111111'
const item: LibraryItem = { id: '22222222-2222-4222-8222-222222222222', cache_id: cacheId, owner_id: 'owner', owner_name: 'Owner', title: 'Tent', description: null, is_consumable: false, quantity: null, available: true, photo_version: null, created_at: 1, caches: [], pending_count: 0 }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function render(element: ReactElement, options: { incomplete?: boolean; moreItems?: boolean; libraryError?: boolean } = {}) {
  vi.stubGlobal('location', { origin: 'https://communalcache.com' })
  vi.stubGlobal('sessionStorage', { getItem: () => null })
  vi.stubGlobal('localStorage', { getItem: () => null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  client.setQueryData(['me'], { id: 'owner', display_name: 'Owner', email: 'private@example.test' })
  client.setQueryData(['caches'], [])
  client.setQueryData(['cache', cacheId], { id: cacheId, name: 'Tools', owner_id: 'owner', members: [], requires_approval: false, invite_token: `${cacheId}.${'A'.repeat(43)}` })
  client.setQueryData(['items', cacheId], [])
  client.setQueryData(['join-requests', cacheId], [])
  client.setQueryData(['item-requests', cacheId, item.id], [])
  client.setQueryData(['library-item', 'owner', item.id], item)
  client.setQueryData(['library', 'owner'], { pages: [{ items: [], next_cursor: options.moreItems ? 'more' : null, totals: { total_count: 0, lend_count: 0, give_count: 0, unshared_count: 0, shared_cache_count: 0 } }], pageParams: [null] })
  if (options.libraryError) client.getQueryCache().find({ queryKey: ['library', 'owner'] })!.setState({ status: 'error', error: new Error('Unavailable') })
  client.setQueryData(['home-summary'], { owned_item_count: 0, pending_answer_count: 0, incoming: [], outgoing: [] })
  client.setQueryData(['requests'], { pages: [{ requests: [], unavailable_cache_ids: options.incomplete ? ['unavailable'] : [], next_cursor: null }], pageParams: [null] })
  client.setQueryData(['requests', 'incoming'], { pages: [{ requests: [], unavailable_cache_ids: [], next_cursor: null }], pageParams: [null] })
  client.setQueryData(['admin', 'owner', 'overview'], { users: 0, caches: 0, items: 0, pending_requests: 0, outbox_pending: 0, outbox_failed: 0, outbox_oldest_age_ms: null, cleanup_pending: 0, cleanup_oldest_age_ms: null, plans: [{ plan: 'free' }] })
  for (const key of ['caches', 'users', 'failed-outbox']) client.setQueryData(['admin', 'owner', key, null], { rows: [], next_cursor: null })
  client.setQueryData(['admin', 'owner', 'flags'], { flags: [] })
  const route = createElement(Routes, null, createElement(Route, { path: '/caches/:cacheId', element }))
  const children = createElement(MemoryRouter, { initialEntries: [`/caches/${cacheId}`] }, route)
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children })))
  client.clear()
  return html
}
function emptyList(html: string, copy: string, listClass?: string) {
  const lists = [...html.matchAll(/<ul\b([^>]*)>([\s\S]*?)<\/ul>/g)]
  const list = lists.find(match => (!listClass || match[1].includes(listClass)) && match[2].includes(copy))
  expect(list, `Expected ${JSON.stringify(copy)} inside ${listClass ?? 'a list'}`).toBeDefined()
  expect(list![2]).toMatch(/<li class="cc-list-empty(?:[^"]*)">/)
  expect(html.split(copy)).toHaveLength(2)
}

it('keeps Home cache/item/ask empty states and their actions inside their lists', () => {
  const html = render(createElement(HomePage))
  emptyList(html, 'No caches yet. Create one to start sharing.', 'cc-home-boxes')
  emptyList(html, 'No things yet.', 'cc-home-things')
  emptyList(html, 'No asks in your current caches.', 'cc-home-asks')
  expect(html).toContain('href="/items/new"')
  expect(html).toContain('See all asks')
})

it('keeps the library empty state inside the tile grid with its create action', () => {
  const html = render(createElement(LibraryPage))
  emptyList(html, 'No items yet. Add something you can lend or give away.','cc-library-grid')
  expect(html).not.toContain('cc-library-columns')
  expect(html).toContain('href="/items/new"')
})

it.each([false, true])('keeps incomplete library guidance in-row even after retained-data errors (error=%s)', libraryError => {
  const html = render(createElement(LibraryPage), { moreItems: true, libraryError })
  emptyList(html, 'Showing matches from 0 loaded items. Load more to include the rest.')
  expect(html).not.toContain('No items yet.')
  expect(html).toContain('Load more items')
  if (libraryError) expect(html).toContain('Previously loaded items may be out of date.')
})

it.each([false, true])('puts all three request-group empty messages inside their lists (incomplete=%s)', incomplete => {
  const html = render(createElement(RequestsPage), { incomplete })
  for (const message of ['No asks need your answer in the loaded results.', 'No answered asks for your things in the loaded results.', 'None of your asks are visible in the loaded results.']) {
    emptyList(html, message + (incomplete && !message.startsWith('No asks need') ? ' This list may be incomplete.' : ''), 'cc-request-slip')
  }
})

it('keeps cache contents and defensive member-empty states inside their collections', () => {
  const html = render(createElement(CachePage))
  emptyList(html, 'Nothing in here yet')
  emptyList(html, 'No members yet.', 'cc-member-list')
  expect(html).toContain('+ Add the first thing')
  emptyList(render(createElement(CacheSettingsPage)), 'No members yet.', 'cc-list')
})

it('keeps item-request empty copy in-list', () => {
  emptyList(render(createElement(ItemRequests, { item, askOpen: false, onAskClose: () => {} })), 'No visible requests for this item yet.', 'cc-detail-ask-list')
})

it('keeps join requests, the add-item selector and sharing empties inside their lists', () => {
  emptyList(render(createElement(JoinRequests, { cacheId })), 'No pending join requests.', 'cc-list')
  const adding = render(createElement(AddItemSheet, { cacheId, cacheName: 'Tools', dialog: { current: null } }))
  emptyList(adding, 'No items yet. Choose New item to start your library.', 'cc-add-selection')
  const sharing = render(createElement(ShownIn, { item }))
  emptyList(sharing, 'Not in any caches yet.', 'cc-cache-list')
  expect(sharing).toContain('>In caches</h2>')
})

it('keeps admin empty states in the switch list and full-width table cells', () => {
  const html = render(createElement(AdminPage))
  emptyList(html, 'No switches configured.', 'cc-list')
  for (const [message, columns] of [['No caches.', 5], ['No users.', 8], ['No failed deliveries.', 6]]) {
    expect(html).toContain(`<tr><td class="cc-list-empty" colSpan="${columns}">${message}</td></tr></tbody>`)
  }
})

it('removes the stock helper while keeping cache-picker empty guidance inside its choices', () => {
  const html = render(createElement(ItemForm, { cacheId: null, onSaved: () => {}, onCancel: () => {} }))
  const choices = html.match(/<fieldset class="cc-put-it-in">([\s\S]*?)<\/fieldset>/)![1]
  expect(choices).toMatch(/<div class="cc-select-options"><p class="cc-list-empty">No caches yet\. Your item stays private in your library\.<\/p><\/div>/)
  expect(html).not.toContain("One item, one stock count, wherever it&#x27;s shown.")
})
