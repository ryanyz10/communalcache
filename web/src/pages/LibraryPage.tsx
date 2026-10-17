import type { ReactNode } from 'react'
import { useState } from 'react'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/api'
import { filterLibraryItems, useLibrary, type LibraryFilter } from '../lib/items'
import { useHomeSummary } from '../lib/caches'
import { OnboardingPage } from './OnboardingPage'
import { Cat } from '../components/Cat'
import { Stamp } from '../components/Stamp'
import { ThingTile, ThingStatus } from '../components/ThingTile'
import { boxColor } from '../components/Box'
import { LibrarySkeleton } from '../components/skeletons/LibrarySkeleton'
import { LoadingStatus, Shimmer } from '../components/Skeleton'

export function LibraryPage() {
  const { me } = useAuth()
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const libraryQuery = useLibrary(me?.display_name ? me.id : undefined)
  const summaryQuery = useHomeSummary(!!me?.display_name)
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  if (libraryQuery.isPending) return <LibrarySkeleton user={me} filter={filter} pendingAnswerCount={summaryQuery.isError ? undefined : summaryQuery.data?.pending_answer_count} />

  const loadedItems = libraryQuery.data?.pages.flatMap(page => page.items) ?? []
  const items = filterLibraryItems(loadedItems, filter)
  const totals = libraryQuery.data?.pages[0]?.totals
  const filters = [
    ['all', 'All', 'All', totals?.total_count],
    ['lend', 'To lend', 'Lend', totals?.lend_count],
    ['give', 'To give', 'Give', totals?.give_count],
    ['unshared', 'Not shared yet', 'Not shared', totals?.unshared_count],
  ] as const

  return <main className="organic-library">
    <div className="cc-library-hero">
      <span className="cc-library-cat" aria-hidden="true"><Cat userId={me.id} coat={me.cat_coat} pose="sit" /></span>
      <span className="cc-box-handle" aria-hidden="true" />
      {!summaryQuery.isError && !!summaryQuery.data?.pending_answer_count && <Link to="/requests" className="cc-library-asks">
        <Stamp tone="warn">{summaryQuery.data.pending_answer_count} {summaryQuery.data.pending_answer_count === 1 ? 'ask' : 'asks'}<span className="cc-desktop-copy"> waiting</span></Stamp>
      </Link>}
      <div>
        <h1>{me.display_name}'s things</h1>
        {totals && <p>{totals.total_count} {totals.total_count === 1 ? 'thing' : 'things'} · <span className="cc-desktop-copy">shared </span>in {totals.shared_cache_count} {totals.shared_cache_count === 1 ? 'cache' : 'caches'}<span className="cc-desktop-copy"> · one stock count each</span></p>}
      </div>
      <Link to="/items/new" className="cc-library-new">+ New item</Link>
    </div>
    <section aria-label="Your items" className="cc-library-contents">
      <div className="cc-library-filters" role="group" aria-label="Filter your items">
        {filters.map(([value, desktopLabel, phoneLabel, count]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
          <span className="cc-desktop-copy">{desktopLabel}</span><span className="cc-phone-copy">{phoneLabel}</span>{count !== undefined ? ` ${count}` : ''}
        </button>)}
      </div>
      {libraryQuery.isError && <div className="cc-read-error">
        <p role="alert">{errorMessage(libraryQuery.error)} Previously loaded items may be out of date.</p>
        <button type="button" onClick={() => void libraryQuery.refetch()}>Try your items again</button>
      </div>}
      <div className="cc-packing-slip cc-library-slip">
        <div className="cc-library-columns" aria-hidden="true"><span /><span>Thing</span><span>Kind</span><span>Shown in</span><span>Status</span><span /></div>
        <ul>{items.map(item => {
          let actionPath: string
          let actionLabel: ReactNode
          if (item.pending_count) {
            actionPath = '/requests'
            actionLabel = 'Review'
          } else if (item.caches.length) {
            actionPath = `/items/${item.id}/edit`
            actionLabel = 'Edit'
          } else {
            actionPath = `/items/${item.id}#sharing`
            actionLabel = <><span className="cc-desktop-copy">Share it</span><span className="cc-phone-copy">Share</span></>
          }
          return <li key={item.id} className="cc-library-row">
            <Link className="cc-library-item-main" to={`/items/${item.id}`}>
              {!item.caches.length && !item.photo_version ? <span className="cc-unshared-tile" aria-hidden="true" /> : <ThingTile item={item} library tone="deep" />}
              <strong>{item.title}</strong>
              <span className="cc-library-kind">{item.is_consumable ? `Give · ${item.quantity} left` : 'Lend'}</span>
            </Link>
            <span className="cc-library-shared">
              {item.caches.length ? <>
                <span className="cc-phone-copy">{item.caches.map(cache => cache.name).join(' · ')}</span>
                <span className="cc-library-chips">{item.caches.map(cache => <Link to={`/caches/${cache.id}`} key={cache.id}>
                  <span style={{ background: boxColor(cache.id) }} aria-hidden="true" />{cache.name}
                </Link>)}</span>
              </> : <span>Not in a cache yet</span>}
            </span>
            <span className="cc-library-status">
              {!!item.caches.length && <>
                <span className="cc-phone-copy"><ThingStatus item={item} pending={item.pending_count} compact /></span>
                <span className="cc-desktop-copy"><ThingStatus item={item} pending={item.pending_count} quantityAsStatus={false} /></span>
              </>}
            </span>
            <Link className={`cc-library-row-action${item.pending_count ? ' cc-library-review' : ''}${!item.caches.length ? ' cc-library-share' : ''}`} to={actionPath}>
              {actionLabel}<span className="sr-only"> {item.title}</span>
            </Link>
          </li>
        })}
          {(libraryQuery.isSuccess || libraryQuery.hasNextPage) && !items.length && <li className="cc-list-empty">
            {libraryQuery.hasNextPage ? <p role="status">Showing matches from {loadedItems.length} loaded items. Load more to include the rest.</p> : <>
              <p>{totals?.total_count ? 'No items match this filter.' : 'No items yet. Add something you can lend or give away.'}</p>
              <Link to="/items/new" className="cc-text-action">+ New item</Link>
            </>}
          </li>}
        </ul>
      </div>
      {libraryQuery.hasNextPage && !!items.length && <p role="status" className="cc-form-hint">Showing matches from {loadedItems.length} loaded items. Load more to include the rest.</p>}
      {libraryQuery.hasNextPage && <button type="button" disabled={libraryQuery.isFetchingNextPage} onClick={() => void libraryQuery.fetchNextPage()} className="cc-profile-secondary cc-library-more">
        {libraryQuery.isFetchingNextPage ? <><LoadingStatus label="Loading more items…" /><Shimmer width={110} height={18} /></> : 'Load more items'}
      </button>}
    </section>
  </main>
}
