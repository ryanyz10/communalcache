import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { AppHeader } from '../components/AppHeader'
import { HomePage } from '../pages/HomePage'
import { AccountPage } from '../pages/AccountPage'
import { CachePage } from '../pages/CachePage'
import { CacheSettingsPage } from '../pages/CacheSettingsPage'
import { pendingIncomingCount, type ItemRequest, type RequestsPageData } from './requests'
import { shareInvite } from './invites'
import { apiFetch } from './api'

const id = '11111111-1111-4111-8111-111111111111'
const cache = { id, name: 'Maple Street', owner_id: 'owner', requires_approval: true, invite_token: `${id}.${'a'.repeat(43)}`, members: [{ user_id: 'owner', display_name: 'Ryan' }, { user_id: 'member', display_name: 'Priya' }] }
const row: ItemRequest = { id: 'incoming', cache_id: id, cache_name: cache.name, item_id: 'item', item_title: 'Starter', owner_id: 'owner', owner_name: 'Ryan', requester_id: 'member', requester_name: 'Priya', quantity: 1, status: 'pending', decision_reason: null, decided_at: null, created_at: 1 }
function render(element: ReactElement, options: { caller?: string; path?: string; route?: string; pages?: RequestsPageData[] } = {}) {
  vi.stubGlobal('location', { origin: 'https://communalcache.com' })
  vi.stubGlobal('sessionStorage', { getItem: () => null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['me'], { id: options.caller ?? 'owner', display_name: 'Ryan', email: 'private@example.test' })
  client.setQueryData(['cache', id], cache)
  client.setQueryData(['caches'], [{ id, name: cache.name }])
  client.setQueryData(['join-requests', id], [{ user_id: 'applicant', display_name: 'Lee', created_at: 1 }])
  client.setQueryData(['items', id], [])
  const pages = options.pages ?? [{ requests: [row], unavailable_cache_ids: [], next_cursor: null }]
  client.setQueryData(['requests'], { pages, pageParams: pages.map(() => null) })
  const routed = createElement(Routes, null, createElement(Route, { path: options.route ?? '/', element }))
  const result = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, { initialEntries: [options.path ?? '/'] }, routed) })))
  client.clear()
  return result
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('counts only pending incoming requests for the profile badge', () => {
  const outgoing = { ...row, id: 'outgoing', requester_id: 'owner', owner_id: 'member', status: 'approved' as const, decided_at: 2 }
  const decidedIncoming = { ...row, id: 'decided', status: 'rejected' as const, decided_at: 3 }
  const second = { ...row, id: 'second' }, third = { ...outgoing, id: 'third', status: 'rejected' as const }
  const rows = [outgoing, decidedIncoming, row, third, second]
  expect(pendingIncomingCount(rows, 'owner')).toBe(2)
  expect(pendingIncomingCount(rows, 'outsider')).toBe(0)
})

it('renders accessible header destinations, avatar and a first-page-only badge, hidden at zero', () => {
  const pages: RequestsPageData[] = [{ requests: [row], unavailable_cache_ids: [], next_cursor: 'next' }, { requests: [{ ...row, id: 'later' }], unavailable_cache_ids: [], next_cursor: null }]
  const markup = render(createElement(AppHeader), { pages })
  expect(markup).toContain('aria-label="Home"')
  expect(markup).toContain('href="/account"')
  expect(markup).toContain('aria-label="Account"')
  expect(markup).toContain('Requests, 1 pending incoming on the first page')
  expect(markup).not.toContain('2 pending incoming')
  expect(markup).not.toContain('private@example.test')
  const empty = render(createElement(AppHeader), { pages: [{ requests: [], unavailable_cache_ids: [], next_cursor: null }] })
  expect(empty).not.toContain('pending incoming on the first page')
  expect(render(createElement(AppHeader), { route: '/login', path: '/login' })).toBe('')
})

it('restores the pending request badge with the direct-D1 aggregate page', () => {
  const markup = render(createElement(AppHeader))
  expect(markup).toContain('pending incoming on the first page')
  expect(markup).toContain('Requests, 1 pending incoming on the first page')
})

it('renders caches and a library link on home without a request preview, account controls or invented counts', () => {
  const outgoing = { ...row, id: 'outgoing', item_title: 'Ladder', requester_id: 'owner', owner_id: 'member', owner_name: 'Sam', status: 'approved' as const, decided_at: 2 }
  const markup = render(createElement(HomePage), { pages: [{ requests: [outgoing, row], unavailable_cache_ids: ['unavailable'], next_cursor: 'next' }] })
  expect(markup).toContain('Your caches')
  expect(markup).toContain('Maple Street')
  expect(markup).toContain('See all')
  expect(markup).toContain('href="/items"')
  expect(markup).not.toContain('Priya wants 1 Starter')
  expect(markup).not.toContain('You asked Sam for Ladder')
  expect(markup).not.toContain('preview-heading')
  expect(markup).not.toContain('minmax(0,1fr)_340px')
  for (const absent of ['Sign out', 'Push notifications', 'members ·', 'want to join', 'Refresh']) expect(markup).not.toContain(absent)
  expect(markup).toContain('aria-labelledby="new-cache-heading"')
  expect(markup).toContain('for="cache-name"')
})

it('keeps the cache focused on shared things, with only owners seeing the join banner', () => {
  const options = { route: '/caches/:cacheId', path: `/caches/${id}` }
  const owner = render(createElement(CachePage), options)
  expect(owner).toContain('2 members')
  expect(owner).toContain('1 person')
  expect(owner).toContain('Review')
  expect(owner).toContain('aria-label="Cache settings"')
  expect(owner).toContain('>Invite</button>')
  expect(owner).not.toContain('Reset link')
  expect(owner).not.toContain('Remove Priya')
  const member = render(createElement(CachePage), { ...options, caller: 'member' })
  expect(member).not.toContain('Review')
  expect(member).not.toContain('wants to join')
})

it('limits member settings to members and invite, preserving owner-only destructive confirmations and toggles', () => {
  const options = { route: '/caches/:cacheId/settings', path: `/caches/${id}/settings` }
  const owner = render(createElement(CacheSettingsPage), options)
  for (const text of ['Join requests', 'Approve Lee', 'Reject Lee', 'Remove Priya', 'Confirm removal', 'Reset link', 'Confirm reset', 'Approve new members']) expect(owner).toContain(text)
  const member = render(createElement(CacheSettingsPage), { ...options, caller: 'member' })
  expect(member).toContain('Members')
  expect(member).toContain('Invite link')
  expect(member).toContain('>Copy</button>')
  for (const text of ['Join requests', 'Remove Priya', 'Confirm removal', 'Reset link', 'Confirm reset', 'Approve new members']) expect(member).not.toContain(text)
  expect(owner).not.toContain('private@example.test')
  expect(member).not.toContain('private@example.test')
})

it('shows only the caller email in Account and retains labeled profile/push actions', async () => {
  const markup = render(createElement(AccountPage))
  expect(markup).toContain('private@example.test')
  expect(markup).toContain('What neighbors see')
  expect(markup).toContain('Edit<span class="sr-only"> display name')
  expect(markup).toContain('role="switch"')
  expect(markup).toContain('aria-label="Push notifications"')
  expect(markup).toContain('Sign out')
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ display_name: 'New name' }))
  await apiFetch('/api/me', { method: 'PATCH', body: { display_name: 'New name' } })
  expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({ method: 'PATCH', credentials: 'same-origin', body: '{"display_name":"New name"}' }))
})

it('uses native share when available, clipboard when absent or failed, and does not copy on cancellation', async () => {
  const share = vi.fn(async () => {}), copy = vi.fn(async () => {})
  vi.stubGlobal('navigator', { share, clipboard: { writeText: copy } })
  const url = 'https://communalcache.com/join/fixture'
  expect(await shareInvite(url)).toBe('Invite shared.')
  expect(share).toHaveBeenCalledWith({ url })
  expect(copy).not.toHaveBeenCalled()
  share.mockRejectedValueOnce(new Error('Not supported here'))
  expect(await shareInvite(url)).toBe('Invite copied.')
  copy.mockClear()
  share.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'))
  expect(await shareInvite(url)).toBe('Sharing cancelled.')
  expect(copy).not.toHaveBeenCalled()
  vi.stubGlobal('navigator', { clipboard: { writeText: copy } })
  expect(await shareInvite(url)).toBe('Invite copied.')
  copy.mockRejectedValueOnce(new Error('Clipboard unavailable'))
  await expect(shareInvite(url)).rejects.toThrow('Clipboard unavailable')
})
