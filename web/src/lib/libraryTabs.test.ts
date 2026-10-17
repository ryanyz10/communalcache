import { afterEach, expect, it, vi } from 'vitest'
import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query'
import { filterLibraryItems, libraryQuery, type LibraryFilter, type LibraryItem, type LibraryPageData } from './items'
import { invalidateRequestViews } from './requests'

const clients: QueryClient[] = []
function client() {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  clients.push(value)
  return value
}
afterEach(() => { clients.splice(0).forEach(value => value.clear()); vi.restoreAllMocks() })

function item(id: string, give = false, unshared = false): LibraryItem {
  return { id, cache_id: null, owner_id: 'owner', owner_name: 'Owner', title: id, description: null,
    is_consumable: give, quantity: give ? 0 : null, available: false, created_at: 1, photo_version: null,
    caches: unshared ? [] : [{ id: 'cache', name: 'Tools' }], pending_count: 0 }
}
function page(items: LibraryItem[], next_cursor: string | null, all = items): LibraryPageData {
  return { items, next_cursor, totals: { total_count: all.length, lend_count: all.filter(row => !row.is_consumable).length,
    give_count: all.filter(row => row.is_consumable).length, unshared_count: all.filter(row => !row.caches.length).length, shared_cache_count: 1 } }
}

it('switches local tabs without fetching again and keeps mutation invalidation on the same account key', async () => {
  let rows = [item('tent'), item('salt', true), item('spare-jars', true, true)]
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(page(rows, null)))
  const cache = client(), observer = new InfiniteQueryObserver(cache, libraryQuery('owner'))
  const stop = observer.subscribe(() => {})
  await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
  const expected: Record<LibraryFilter, string[]> = { all: ['tent', 'salt', 'spare-jars'], lend: ['tent'], give: ['salt', 'spare-jars'], unshared: ['spare-jars'] }
  for (const filter of ['all', 'lend', 'give', 'unshared', 'all'] as const) {
    observer.setOptions(libraryQuery('owner'))
    const loaded = observer.getCurrentResult().data!.pages.flatMap(batch => batch.items)
    expect(filterLibraryItems(loaded, filter).map(row => row.id)).toEqual(expected[filter])
    expect(observer.options.queryKey).toEqual(['library', 'owner'])
  }
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toBe('/api/me/items')
  expect(cache.getQueryCache().getAll().map(query => query.queryKey)).toEqual([['library', 'owner']])
  rows = [item('updated-tent')]
  await invalidateRequestViews(cache)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(observer.getCurrentResult().data!.pages[0].items[0].id).toBe('updated-tent')
  stop(); observer.destroy()
})

it('loads the complete four-page library before publishing one dataset for exact local tabs', async () => {
  const rows = Array.from({ length: 100 }, (_, index) => item(`item-${index}`, index >= 75, index === 99))
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const after = Number(new URL(String(input), 'https://communalcache.com').searchParams.get('after') ?? 0)
    return Response.json(page(rows.slice(after, after + 25), after + 25 < rows.length ? String(after + 25) : null, rows))
  })
  const observer = new InfiniteQueryObserver(client(), { ...libraryQuery('owner'), enabled: false })
  const result = await observer.refetch()
  expect(result.data!.pages).toHaveLength(1)
  expect(result.data!.pages[0].items).toHaveLength(100)
  expect(observer.getCurrentResult().hasNextPage).toBe(false)
  expect(filterLibraryItems(result.data!.pages[0].items, 'give')).toHaveLength(25)
  expect(filterLibraryItems(result.data!.pages[0].items, 'unshared').map(row => row.id)).toEqual(['item-99'])
  expect(result.data!.pages[0].totals.total_count).toBe(100)
  expect(fetch.mock.calls.map(call => String(call[0]))).toEqual(['/api/me/items', '/api/me/items?after=25', '/api/me/items?after=50', '/api/me/items?after=75'])
  observer.destroy()
})

it('caps eager work at twenty API pages and preserves Load more continuation for over-cap libraries', async () => {
  const rows = Array.from({ length: 550 }, (_, index) => item(`item-${index}`, index === 549))
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input), 'https://communalcache.com')
    expect(url.searchParams.has('filter')).toBe(false)
    const after = Number(url.searchParams.get('after') ?? 0)
    return Response.json(page(rows.slice(after, after + 25), after + 25 < rows.length ? String(after + 25) : null, rows))
  })
  const observer = new InfiniteQueryObserver(client(), { ...libraryQuery('owner'), enabled: false })
  const initial = await observer.refetch()
  expect(fetch).toHaveBeenCalledTimes(20)
  expect(initial.data!.pages[0].items).toHaveLength(500)
  expect(observer.getCurrentResult().hasNextPage).toBe(true)
  expect(filterLibraryItems(initial.data!.pages[0].items, 'give')).toEqual([])
  const more = await observer.fetchNextPage()
  expect(fetch).toHaveBeenCalledTimes(21)
  expect(more.data!.pages[1].items).toHaveLength(25)
  expect(more.hasNextPage).toBe(true)
  const complete = await observer.fetchNextPage()
  expect(fetch).toHaveBeenCalledTimes(22)
  expect(complete.hasNextPage).toBe(false)
  expect(filterLibraryItems(complete.data!.pages.flatMap(batch => batch.items), 'give').map(row => row.id)).toEqual(['item-549'])
  observer.destroy()
})

it('does not expose a partial successful dataset if a later eager page fails', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(page([item('first-page')], 'next')))
    .mockResolvedValueOnce(Response.json({ error: 'internal_error' }, { status: 503 }))
  const observer = new InfiniteQueryObserver(client(), { ...libraryQuery('owner'), enabled: false })
  const result = await observer.refetch()
  expect(result.isError).toBe(true)
  expect(result.data).toBeUndefined()
  expect(fetch).toHaveBeenCalledTimes(2)
  observer.destroy()
})

it('aborts remaining page reads and discards the dataset when the account query is cancelled', async () => {
  let respond!: (response: Response) => void
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(page([item('first')], 'next')))
    .mockImplementationOnce(async () => new Promise<Response>(resolve => { respond = resolve }))
  const cache = client(), observer = new InfiniteQueryObserver(cache, { ...libraryQuery('owner'), enabled: false })
  const loading = observer.refetch()
  await vi.waitFor(() => expect(respond).toBeDefined())
  await cache.cancelQueries({ queryKey: ['library', 'owner'] })
  expect(fetch.mock.calls[1][1]?.signal?.aborted).toBe(true)
  respond(Response.json(page([item('second')], 'third')))
  await loading
  await Promise.resolve()
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(observer.getCurrentResult().data).toBeUndefined()
  observer.destroy()
})

it('keeps account isolation and disabled reads while sharing the unfiltered query shape', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(page([item('owner-only')], null)))
    .mockResolvedValueOnce(Response.json(page([{ ...item('other-only'), owner_id: 'other' }], null)))
  const observer = new InfiniteQueryObserver(client(), { ...libraryQuery('owner'), enabled: false })
  expect((await observer.refetch()).data!.pages[0].items[0].id).toBe('owner-only')
  observer.setOptions({ ...libraryQuery('other'), enabled: false })
  expect(observer.getCurrentResult().data).toBeUndefined()
  expect((await observer.refetch()).data!.pages[0].items[0].id).toBe('other-only')
  observer.setOptions(libraryQuery(undefined))
  const stop = observer.subscribe(() => {})
  await Promise.resolve()
  expect(observer.getCurrentResult().data).toBeUndefined()
  expect(fetch).toHaveBeenCalledTimes(2)
  stop(); observer.destroy()
})
