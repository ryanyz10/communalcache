import { Link, Navigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/api'
import { sharingHint, useLibrary, type LibraryItem } from '../lib/items'
import { ItemPhoto } from './ItemPhoto'
import { OnboardingPage } from './OnboardingPage'
import { WideBreadcrumbs } from '../components/WideBreadcrumbs'

export function LibraryCards({ items, preview = false }: { items: LibraryItem[]; preview?: boolean }) {
  const Heading = preview ? 'h3' : 'h2'
  return <ul className="cc-list mt-3 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] lg:gap-4 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent">{items.map(item => <li key={item.id} className="border-t border-slate-100 first:border-t-0 lg:border-0">
    <Link to={`/items/${item.id}`} className="flex items-center gap-3 px-4 py-3.5 lg:block lg:h-full lg:overflow-hidden lg:rounded-[14px] lg:border lg:border-slate-200 lg:bg-white lg:p-0">
      <ItemPhoto key={item.photo_version} item={item} thumbnail />
      <div className="min-w-0 flex-1 lg:px-3.5 lg:py-3"><Heading className="break-words font-semibold">{item.title}</Heading>
        <p className="break-words text-sm text-slate-600">{sharingHint(item)}</p>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-700">
          {item.available === false && <span className="rounded-full bg-slate-100 px-2 py-1">Lent out</span>}
          <span className="py-1">{item.is_consumable ? `${item.quantity} to give away` : 'Lend it'}</span>
          {item.pending_count > 0 && <span className="rounded-full bg-amber-100 px-2 py-1">{item.pending_count} pending {item.pending_count === 1 ? 'ask' : 'asks'}</span>}
        </div>
      </div><span aria-hidden="true" className="text-xl text-slate-500 lg:hidden">›</span>
    </Link>
  </li>)}</ul>
}

export function LibrarySection({ preview = false }: { preview?: boolean }) {
  const { me } = useAuth()
  const query = useLibrary(me?.display_name ? me.id : undefined)
  const items = query.data?.pages.flatMap(page => page.items) ?? []
  return <section className={preview ? 'mt-8' : 'mt-4'} aria-labelledby="library-heading">
    <div className="flex items-center justify-between gap-3">
      {preview ? <h2 id="library-heading" className="text-xl font-semibold">Your items</h2> : <h1 id="library-heading" className="text-2xl font-semibold tracking-tight lg:text-[28px] lg:font-bold">Your items</h1>}
      {preview ? <Link to="/items" className="text-sm underline">See all</Link> : <Link to="/items/new" className="cc-pill">+ New item</Link>}
    </div>
    {!preview && <p className="mt-2 text-sm text-slate-600">Your library across all caches. One item, one shared stock count.</p>}
    {query.isPending && <p role="status" className="mt-4">Loading your items…</p>}
    {query.isError && <div className="mt-4"><p role="alert" className="text-red-700">{errorMessage(query.error)} Previously loaded items may be out of date.</p><button type="button" className="mt-2 underline" onClick={() => void query.refetch()}>Try your items again</button></div>}
    {items.length > 0 && <LibraryCards items={preview ? items.slice(0,3) : items} preview={preview} />}
    {query.isSuccess && !items.length && <div className="mt-3 rounded-[10px] border border-slate-200 bg-white p-4"><p className="text-slate-600">No items yet. Add something you can lend or give away. You can choose where to share it later.</p><Link to="/items/new" className="cc-outline mt-3">+ New item</Link></div>}
    {!preview && query.hasNextPage && <button type="button" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} className="cc-outline mt-4">{query.isFetchingNextPage ? 'Loading…' : 'Load more items'}</button>}
  </section>
}

export function LibraryPage() {
  const { me } = useAuth()
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  return <main className="cc-page lg:max-w-[1120px] lg:p-8">
    <WideBreadcrumbs><Link to="/">Home</Link><span aria-hidden="true">›</span><span>Your items</span></WideBreadcrumbs>
    <Link to="/" className="text-sm underline lg:hidden">‹ Home</Link>
    <LibrarySection />
  </main>
}
