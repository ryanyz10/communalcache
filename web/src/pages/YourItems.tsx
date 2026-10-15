import { Link } from 'react-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import { apiFetch, errorMessage } from '../lib/api'
import type { OwnedItemsPage } from '../lib/items'
import { ItemPhoto } from './ItemPhoto'

export function YourItems() {
  const query = useInfiniteQuery({
    queryKey: ['my-items'], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiFetch<OwnedItemsPage>(`/api/me/items${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: page => page.next_cursor ?? undefined,
  })
  const items = query.data?.pages.flatMap(page => page.items) ?? []
  const unavailable = query.data?.pages.flatMap(page => page.unavailable_cache_ids) ?? []
  const incomplete = unavailable.length > 0 || query.isError || query.hasNextPage
  return <section className="mt-8" aria-labelledby="your-items-heading" aria-busy={query.isPending}>
    <h2 id="your-items-heading" className="text-xl font-semibold">Your items</h2>
    {query.isPending && <div role="status" className="mt-3 h-20 animate-pulse rounded-[10px] border border-slate-200 bg-slate-100 motion-reduce:animate-none"><span className="sr-only">Loading your items…</span></div>}
    {query.isError && <div className="mt-3"><p role="alert" className="text-sm text-red-700">{errorMessage(query.error)} Previously loaded items may be out of date.</p><button className="mt-2 text-sm underline" disabled={query.isFetching} onClick={() => void query.refetch()}>Try your items again</button></div>}
    {unavailable.length > 0 && <div className="mt-3"><p role="alert" className="text-sm text-amber-800">Items from {unavailable.length} cache(s) could not be loaded. This list is incomplete.</p><button className="mt-2 text-sm underline" disabled={query.isFetching} onClick={() => void query.refetch()}>Try unavailable caches again</button></div>}
    {items.length > 0 && <ul className="cc-list mt-3 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] lg:gap-4 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent">{items.map(item => <li key={`${item.cache_id}/${item.id}`} className="border-t border-slate-100 first:border-t-0 lg:border-0">
      <Link to={`/caches/${item.cache_id}/items/${item.id}`} className="flex items-center gap-3 px-4 py-3.5 lg:block lg:h-full lg:overflow-hidden lg:rounded-[14px] lg:border lg:border-slate-200 lg:bg-white lg:p-0">
        <ItemPhoto key={item.photo_version} item={{ ...item, owner_name: null }} thumbnail />
        <div className="min-w-0 flex-1 lg:px-3.5 lg:py-3"><h3 className="break-words font-semibold">{item.title}</h3><p className="text-sm text-slate-600">{item.cache_name} · {item.is_consumable ? `${item.quantity} in stock` : 'Reusable'}</p>{item.pending_request_count > 0 && <p className="mt-1 text-xs text-amber-800">{item.pending_request_count} pending {item.pending_request_count === 1 ? 'request' : 'requests'}</p>}</div>
        <span aria-hidden="true" className="text-xl leading-none text-slate-500 lg:hidden">›</span>
      </Link>
    </li>)}</ul>}
    {query.isSuccess && !items.length && <p className="mt-3 text-sm text-slate-600">{incomplete ? 'No items visible in the loaded caches yet. This list may be incomplete.' : 'No items in your discovered caches yet. Open a cache to add something to share.'}</p>}
    {query.hasNextPage && <button className="cc-outline mt-4" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading more…' : 'Load more item caches'}</button>}
    {query.data && <p className="mt-3 text-xs text-slate-600">Cache discovery can lag. Open the cache directly if an item is missing.</p>}
  </section>
}
