import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { ItemRequests, RequestsPage } from '../pages/RequestsPage'
import { ApiError, apiFetch, errorMessage } from './api'
import { invalidateRequestViews, type ItemRequest, type RequestsPageData } from './requests'
import type { Item } from './items'

const item: Item = { id: 'item', cache_id: 'cache', title: 'Sugar', description: null, owner_id: 'owner', owner_name: 'Owner', is_consumable: true, quantity: 5, available_quantity: 3, available: true, unavailable_note: null, photo_version: null, created_at: 1 }
const request: ItemRequest = { id: 'request', cache_id: 'cache', cache_name: 'Pantry', item_id: 'item', item_title: 'Sugar', owner_id: 'owner', owner_name: 'Owner', requester_id: 'member', requester_name: 'Neighbor', quantity: 2, status: 'pending', decision_reason: null, decided_at: null, created_at: 1 }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function render(page: 'item' | 'all', options: { caller?: string; item?: Item; requests?: ItemRequest[]; unavailable?: string[]; next?: string | null; error?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  client.setQueryData(['me'], { id: options.caller ?? 'member', display_name: 'Neighbor', email: 'private@example.test' })
  const rows = options.requests ?? [request]
  const key = ['item-requests', item.cache_id, item.id]
  if (options.error) client.getQueryCache().build(client, { queryKey: key }).setState({ status: 'error', error: new ApiError(503, 'unavailable') })
  else client.setQueryData(key, rows)
  const data: RequestsPageData = { requests: rows, unavailable_cache_ids: options.unavailable ?? [], next_cursor: options.next ?? null }
  client.setQueryData(['requests'], { pages: [data], pageParams: [null] })
  const element = page === 'item' ? createElement(ItemRequests, { item: options.item ?? item }) : createElement(RequestsPage)
  const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, null, element) })))
  client.clear()
  return markup
}

it('shows member quantity/ask controls using canonical all-cache availability', () => {
  const markup = render('item', { item: { ...item, available_quantity: 2 }, requests: [request, { ...request, id: 'other', requester_id: 'other', quantity: 1 }] })
  expect(markup).toContain('Ask to use')
  expect(markup).toContain('Available now: 2')
  expect(markup).toContain('min="1" max="9999" step="1"')
  expect(markup).toContain('Pending requests are visible to cache members')
  expect(markup).toContain('Neighbor')
  expect(markup).not.toContain('Approve request')
  expect(markup).not.toContain('private@example.test')
  const emptyStock = render('item', { item: { ...item, quantity: 2, available_quantity: 0 } })
  expect(emptyStock).toContain('No stock available now')
  expect(emptyStock).toContain('disabled=""')
})

it('uses no quantity for reusable asks and hides self-request controls from the item owner', () => {
  const reusable = render('item', { item: { ...item, quantity: null, is_consumable: false } })
  expect(reusable).toContain('Ask to use')
  expect(reusable).not.toContain('request-quantity')
  const owner = render('item', { caller: 'owner' })
  expect(owner).not.toContain('Ask to use')
  expect(owner).toContain('Approve request from Neighbor')
  expect(owner).toContain('Reject request from Neighbor')
  expect(owner).toContain('Reason for rejection')
  expect(owner).toContain('maxLength="500"')
})

it('does not turn an unavailable item queue into empty data or expose an ask form without availability', () => {
  const markup = render('item', { error: true })
  expect(markup).toContain('role="alert"')
  expect(markup).toContain('Try requests again')
  expect(markup).not.toContain('No visible requests')
  expect(markup).not.toContain('Ask to use')
})

it('groups pending incoming decisions separately from my outgoing statuses and hides decided incoming rows', () => {
  const approved = { ...request, id: 'approved', requester_id: 'owner', owner_id: 'other', status: 'approved' as const, decided_at: 2 }
  const rejected = { ...approved, id: 'rejected', status: 'rejected' as const, decision_reason: '<Not today>' }
  const decidedIncoming = { ...request, id: 'decided-incoming', item_title: 'Decided incoming item', status: 'approved' as const, decided_at: 3 }
  const markup = render('all', { caller: 'owner', requests: [request, approved, rejected, decidedIncoming] })
  expect(markup).toContain('Needs your answer')
  expect(markup).toContain('Your requests')
  expect(markup).not.toContain('Decided incoming item')
  expect(markup).not.toContain('>Your caches</a>')
  expect(markup).toContain('Approved')
  expect(markup).toContain('Rejected')
  expect(markup).toContain('&lt;Not today&gt;')
  expect(markup).toContain('/caches/cache/items/item')
  expect(markup.match(/Approve request from/g)).toHaveLength(1)
  expect(markup).not.toContain('Cancel request')
})

it('preserves partial-unavailable warnings and continuation instead of pretending the aggregate is complete', () => {
  const partial = render('all', { requests: [], unavailable: ['cache-a'], next: 'cache-next' })
  expect(partial).toContain('lists are incomplete')
  expect(partial).toContain('Load more requests')
  expect(partial).toContain('in the loaded results')
  expect(partial).toContain('Try unavailable caches again')
  expect(render('all', { requests: [] })).not.toContain('Load more requests')
})

it('reopens the request page without a migration message or discovery-lag claim', () => {
  const markup = render('all', { caller: 'owner' })
  expect(markup).toContain('Needs your answer')
  expect(markup).toContain('Approve request')
  expect(markup).not.toContain('Requests are being moved')
  expect(markup).not.toContain('discovery can lag')
})

it('does not infer other-cache availability from the visible queue and blocks new asks while Lent out', () => {
  const shared = render('item', { item: { ...item, available_quantity: 1 }, requests: [] })
  expect(shared).toContain('Available now: 1')
  expect(shared).not.toContain('Available now: 5')
  const missing = render('item', { item: { ...item, available_quantity: undefined } })
  expect(missing).toContain('Refresh the item to see current availability')
  const lent = render('item', { item: { ...item, available: false, unavailable_note: 'With a neighbor' } })
  expect(lent).toContain('Lent out · With a neighbor')
  expect(lent).toMatch(/<button[^>]*disabled=""[^>]*>Ask to use/)
})

it('offers the reusable approval checkbox without blocking decisions on existing Lent out requests', () => {
  const markup = render('item', { caller: 'owner', item: { ...item, is_consumable: false, quantity: null, available: false }, requests: [{ ...request, quantity: null }] })
  expect(markup).toContain('Mark as lent out')
  expect(markup).toContain('Approve request from Neighbor')
  expect(markup).not.toContain('Ask to use')
  expect(render('item', { caller: 'owner' })).not.toContain('Mark as lent out')
})

it('uses nested cookie-auth mutations without forged party IDs and invalidates every affected view', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(request))
  await apiFetch('/api/caches/cache/items/item/requests', { body: { quantity: 2 } })
  await apiFetch('/api/me/requests/request/approve', { body: { mark_lent_out: true, unavailable_note: 'Back tomorrow' } })
  await apiFetch('/api/me/requests/request/reject', { body: { reason: 'Not today' } })
  expect(fetchMock.mock.calls.every(call => call[1]?.credentials === 'same-origin' && call[1]?.method === 'POST')).toBe(true)
  expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('requester_id')
  expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('owner_id')
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue()
  await invalidateRequestViews(client)
  expect(invalidate.mock.calls.map(call => call[0]?.queryKey)).toEqual([['item-requests'], ['requests'], ['item'], ['items']])
  client.clear()
})

it('explains request quantity, stock races, already-decided conflicts and required rejection reasons', () => {
  expect(errorMessage(new ApiError(400, 'invalid_request_quantity'))).toContain('1 to 9999')
  expect(errorMessage(new ApiError(409, 'insufficient_stock'))).toContain('not enough available stock')
  expect(errorMessage(new ApiError(409, 'request_not_pending'))).toContain('already been decided')
  expect(errorMessage(new ApiError(400, 'invalid_reason'))).toContain('1 and 500')
  expect(errorMessage(new ApiError(409, 'item_unavailable'))).toContain('lent out')
  expect(errorMessage(new ApiError(400, 'invalid_unavailable_note'))).toContain('200')
})
