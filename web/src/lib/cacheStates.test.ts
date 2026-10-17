import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { CachePage } from '../pages/CachePage'
import { CacheSettingsPage } from '../pages/CacheSettingsPage'
import { ApiError } from './api'
import type { CacheDetail, CacheSummary } from './caches'
import type { Item } from './items'

type ReadState = 'success' | 'pending' | 'error' | 'stale-error' | 'fetching'
type Caller = 'owner' | 'member' | 'unnamed' | 'signed-out'
const cacheId = '11111111-1111-4111-8111-111111111111'
const cache: CacheDetail = {
  id: cacheId,
  name: 'Tools',
  owner_id: 'owner',
  invite_token: `${cacheId}.${'A'.repeat(43)}`,
  requires_approval: true,
  members: [
    { user_id: 'owner', display_name: 'Owner', attached_item_count: 1 },
    { user_id: 'member', display_name: 'Member', attached_item_count: 1 },
  ],
}
const summary: CacheSummary = {
  ...cache,
  active_member_count: 2,
  attached_item_count: 2,
  pending_answer_count: 2,
  member_preview: cache.members,
}
const tent: Item & { pending_count: number } = {
  id: 'tent',
  cache_id: cacheId,
  owner_id: 'owner',
  owner_name: 'Owner',
  title: 'Tent',
  description: 'For camping',
  is_consumable: false,
  quantity: null,
  available: true,
  created_at: 1,
  photo_version: null,
  pending_count: 2,
}
const jars = {
  ...tent,
  id: 'jars',
  owner_id: 'member',
  owner_name: 'Member',
  title: 'Jars',
  is_consumable: true,
  quantity: 2,
  available_quantity: 0,
  pending_count: 0,
}
const clients: QueryClient[] = []
afterEach(() => {
  clients.forEach(client => client.clear())
  clients.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup(page: 'cache' | 'settings', options: {
  caller?: Caller
  cacheState?: ReadState
  itemsState?: ReadState
  cachesState?: ReadState
  joinsState?: ReadState
  knownSummary?: boolean
  empty?: boolean
  itemsMoving?: boolean
} = {}) {
  vi.stubGlobal('location', { origin: 'http://localhost:5198' })
  const client = new QueryClient({ defaultOptions: { queries: {
    retry: false,
    retryOnMount: false,
    staleTime: Infinity,
  } } })
  clients.push(client)
  const caller = options.caller ?? 'owner'
  const me = caller === 'signed-out' ? null : {
    id: caller,
    display_name: caller === 'unnamed' ? null : 'Neighbor',
    email: 'own@example.test',
  }
  client.setQueryData(['me'], me)
  if (me) client.setQueryData(['library', me.id], {
    pages: [{ items: [], next_cursor: null }],
    pageParams: [null],
  })
  const reads = [
    { key: ['cache', cacheId], data: cache, state: options.cacheState ?? 'success' },
    { key: ['items', cacheId], data: options.empty ? [] : [tent, jars], state: options.itemsState ?? 'success' },
    { key: ['caches'], data: options.knownSummary === false ? [] : [summary, { ...summary, id: 'other', name: 'Other cache' }], state: options.cachesState ?? 'success' },
    { key: ['join-requests', cacheId], data: [{ user_id: 'applicant', display_name: 'Private applicant', created_at: 1 }], state: options.joinsState ?? 'success' },
  ]
  for (const { key, data, state } of reads) {
    if (state === 'pending') continue
    if (state !== 'error') client.setQueryData(key, data)
    if (state === 'error' || state === 'stale-error') {
      client.getQueryCache().build(client, { queryKey: key }).setState({
        status: 'error', error: new ApiError(503, 'internal_error'),
      })
    }
    if (state === 'fetching') client.getQueryCache().find({ queryKey: key })!.setState({ fetchStatus: 'fetching' })
  }
  const path = page === 'settings' ? '/caches/:cacheId/settings' : '/caches/:cacheId'
  const entry = `/caches/${cacheId}${page === 'settings' ? '/settings' : ''}`
  const element = page === 'settings' ? createElement(CacheSettingsPage) : createElement(CachePage, { itemsMoving: options.itemsMoving })
  const render = () => renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, {
    children: createElement(MemoryRouter, { initialEntries: [entry] }, createElement(Routes, null, createElement(Route, { path, element }))),
  })))
  return { client, render, html: render() }
}

it.each([true, false])('keeps cache metadata loading distinct with known summary=%s', knownSummary => {
  const { html } = setup('cache', { cacheState: 'pending', knownSummary })
  expect(html).toContain('data-skeleton="cache"')
  expect(html).toContain('Loading cache…')
  expect(html).not.toContain('Tent')
  expect(html).not.toContain('cc-contents-row')
  expect(html.includes('>Tools</h1>')).toBe(knownSummary)
})

it.each(['error', 'stale-error'] as const)('does not mistake cache metadata %s for authorized contents', cacheState => {
  const { html } = setup('cache', { cacheState })
  expect(html).toContain('Couldn&#x27;t open this box')
  expect(html).toContain('Try again')
  expect(html).not.toContain('Tent')
  expect(html).not.toContain('cc-contents-row')
})

it.each(['error', 'stale-error'] as const)('prioritizes item %s over stale rows or empty copy', itemsState => {
  const { html } = setup('cache', { itemsState })
  expect(html).toContain('Couldn&#x27;t open this box')
  expect(html).not.toContain('Nothing in here yet')
  expect(html).not.toContain('cc-contents-row')
})

it('keeps cached rows while background reads fetch, without introducing a placeholder handoff', () => {
  const { html } = setup('cache', { cacheState: 'fetching', itemsState: 'fetching' })
  expect(html).toContain('Tent')
  expect(html).toContain('Jars')
  expect(html).not.toContain('cc-cache-skeleton-exit')
  expect(html).not.toContain('cc-skeleton-swap')
})

it('keeps the empty Add entry and one mounted add sheet, while moving mode disables items and Add', () => {
  const empty = setup('cache', { empty: true })
  expect(empty.html).toContain('+ Add the first thing')
  expect(empty.html.match(/<dialog\b/g)).toHaveLength(1)
  const moving = setup('cache', { itemsMoving: true, itemsState: 'pending' })
  expect(moving.html).toContain('Items are being moved, back soon')
  expect(moving.html).not.toContain('cc-cache-add')
  expect(moving.html).not.toContain('cc-add-items')
  expect(moving.client.getQueryCache().find({ queryKey: ['items', cacheId] })!.options).toMatchObject({ enabled: false })
})

it('hides cached other-cache folders on a list failure and keeps the owner queue warning scoped', () => {
  const owner = setup('cache', { cachesState: 'stale-error', joinsState: 'stale-error' }).html
  const folders = owner.match(/<nav class="cc-cache-folders"[^>]*>([\s\S]*?)<\/nav>/)![1]
  expect(folders).toContain('Tools')
  expect(folders).not.toContain('Other cache')
  expect(owner).toContain('Join requests could not be loaded.')
  const member = setup('cache', { caller: 'member', joinsState: 'stale-error' })
  expect(member.html).not.toContain('Join requests could not be loaded.')
  expect(member.html).not.toContain('person wants')
  expect(member.client.getQueryCache().find({ queryKey: ['join-requests', cacheId] })!.options).toMatchObject({ enabled: false })
})

it('renders settings loading/error separately and recovers using its original exact query', async () => {
  expect(setup('settings', { cacheState: 'pending' }).html).toContain('data-skeleton="cache-settings"')
  const failed = setup('settings', { cacheState: 'stale-error' })
  expect(failed.html).toContain('Try again')
  expect(failed.html).not.toContain(cache.invite_token)
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(cache))
  const query = failed.client.getQueryCache().find({ queryKey: ['cache', cacheId] })!
  const observer = new QueryObserver(failed.client, { ...query.options, queryKey: query.queryKey })
  await observer.refetch()
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/caches/${cacheId}`, expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
  expect(failed.render()).toContain('Reset link')
  expect(failed.render()).toContain('Edit<span class="sr-only"> cache name')
  observer.destroy()
})

it.each(['owner', 'member', 'unnamed', 'signed-out'] as const)('preserves cache query keys and enabled predicates for %s', caller => {
  const { client } = setup('cache', { caller })
  const named = caller === 'owner' || caller === 'member'
  for (const key of [['cache', cacheId], ['caches'], ['items', cacheId]]) {
    expect(client.getQueryCache().find({ queryKey: key, exact: true })!.options).toMatchObject({ enabled: named, retry: false })
  }
  expect(client.getQueryCache().find({ queryKey: ['join-requests', cacheId], exact: true })!.options).toMatchObject({ enabled: caller === 'owner' })
})

it.each(['cache', 'settings'] as const)('makes zero disabled reads for unnamed/signed-out %s contexts', async page => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(cache))
  for (const caller of ['unnamed', 'signed-out'] as const) {
    const { client, html } = setup(page, { caller, cacheState: 'pending', itemsState: 'pending', cachesState: 'pending', joinsState: 'pending' })
    expect(html).not.toContain('Tools')
    const queries = client.getQueryCache().getAll().filter(query => query.queryKey[0] !== 'me' && query.queryKey[0] !== 'library')
    const stops = queries.map(query => new QueryObserver(client, { ...query.options, queryKey: query.queryKey }).subscribe(() => {}))
    await Promise.resolve()
    expect(queries.every(query => query.state.fetchStatus === 'idle')).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    stops.forEach(stop => stop())
  }
})
