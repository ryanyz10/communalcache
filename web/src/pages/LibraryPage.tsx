import { useState } from 'react'
import { Link } from 'react-router'
import { useProfile } from '../auth/AuthProvider'
import { errorMessage } from '../lib/api'
import { filterLibraryItems, useLibrary, type LibraryFilter } from '../lib/items'
import { ThingTile } from '../components/ThingTile'
import { LibrarySkeleton } from '../components/skeletons/LibrarySkeleton'
import { LoadingStatus, Shimmer } from '../components/Skeleton'

export function LibraryPage() {
  const me = useProfile()
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const libraryQuery = useLibrary(me.id)
  if (libraryQuery.isPending) return <LibrarySkeleton filter={filter} />

  const loadedItems = libraryQuery.data?.pages.flatMap(page => page.items) ?? []
  const items = filterLibraryItems(loadedItems, filter)
  const totals = libraryQuery.data?.pages[0]?.totals
  const filters = [
    ['all','All',totals?.total_count], ['lend','Lend',totals?.lend_count],
    ['give','Give',totals?.give_count], ['unshared','Not shared',totals?.unshared_count],
  ] as const

  return <main className="organic-library">
    <div className="cc-library-header">
      <h1>Your items</h1>
      <Link to="/items/new" state={{itemEditor:true}} data-item-editor-trigger="new" className="cc-profile-primary cc-library-new"><span className="cc-phone-copy">+ New</span><span className="cc-desktop-copy">+ New item</span></Link>
    </div>
    <section aria-label="Your items" className="cc-library-contents">
      <div className="cc-library-filters" role="group" aria-label="Filter your items">
        {filters.map(([value,label,count]) => <button type="button" key={value} aria-pressed={filter===value} onClick={() => setFilter(value)}>{label}{count!==undefined?` ${count}`:''}</button>)}
      </div>
      {libraryQuery.isError && <div className="cc-read-error">
        <p role="alert">{errorMessage(libraryQuery.error)} Previously loaded items may be out of date.</p>
        <button type="button" onClick={() => void libraryQuery.refetch()}>Try your items again</button>
      </div>}
      <ul className="cc-library-grid">{items.map(item => <li key={item.id} className={`cc-library-tile${item.active===false?' cc-item-inactive':''}`}>
        <Link to={`/items/${item.id}`} className="cc-library-item">
          <ThingTile item={item} library />
          <div className="cc-library-caption">
            <strong>{item.title}</strong>
            <p className="cc-library-kind">{item.is_consumable?`Give · ${item.quantity}`:'Lend'}{item.active===false?<span> · Inactive</span>:item.available===false?<span className="cc-library-lent"> · Lent out</span>:null}</p>
          </div>
        </Link>
      </li>)}
        {(libraryQuery.isSuccess || libraryQuery.hasNextPage) && !items.length && <li className="cc-list-empty">
          {libraryQuery.hasNextPage ? <p role="status">Showing matches from {loadedItems.length} loaded items. Load more to include the rest.</p> : <>
            <p>{totals?.total_count?'No items match this filter.':'No items yet. Add something you can lend or give away.'}</p>
            <Link to="/items/new" state={{itemEditor:true}} data-item-editor-trigger="new" className="cc-text-action">+ New item</Link>
          </>}
        </li>}
      </ul>
      {libraryQuery.hasNextPage && !!items.length && <p role="status" className="cc-form-hint">Showing matches from {loadedItems.length} loaded items. Load more to include the rest.</p>}
      {libraryQuery.hasNextPage && <button type="button" disabled={libraryQuery.isFetchingNextPage} onClick={() => void libraryQuery.fetchNextPage()} className="cc-profile-secondary cc-library-more">
        {libraryQuery.isFetchingNextPage?<><LoadingStatus label="Loading more items…" /><Shimmer width={110} height={18} /></>:'Load more items'}
      </button>}
    </section>
  </main>
}
