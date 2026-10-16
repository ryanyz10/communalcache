import { useState } from 'react'
import { Link,Navigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/api'
import { useLibrary,type LibraryFilter } from '../lib/items'
import { useHomeSummary } from '../lib/caches'
import { OnboardingPage } from './OnboardingPage'
import { Cat } from '../components/Cat'
import { Stamp } from '../components/Stamp'
import { ThingTile,ThingStatus } from '../components/ThingTile'
import { boxColor } from '../components/Box'

export function LibraryPage() {
  const { me }=useAuth()
  const [filter,setFilter]=useState<LibraryFilter>('all')
  const query=useLibrary(me?.display_name?me.id:undefined,filter),summary=useHomeSummary(!!me?.display_name)
  if(!me) return <Navigate to="/login" replace />
  if(!me.display_name) return <OnboardingPage />
  const items=query.data?.pages.flatMap(page=>page.items) ?? [],totals=query.data?.pages[0]?.totals
  const filters=[['all','All','All',totals?.total_count],['lend','To lend','Lend',totals?.lend_count],['give','To give','Give',totals?.give_count],['unshared','Not shared yet','Not shared',totals?.unshared_count]] as const
  return <main className="organic-library">
    <div className="cc-library-hero"><span className="cc-library-cat" aria-hidden="true"><Cat userId={me.id} coat={me.cat_coat} pose="sit" /></span><span className="cc-box-handle" aria-hidden="true" />
      {!summary.isError && !!summary.data?.pending_answer_count && <Link to="/requests" className="cc-library-asks"><Stamp tone="warn">{summary.data.pending_answer_count} {summary.data.pending_answer_count===1?'ask':'asks'}<span className="cc-desktop-copy"> waiting</span></Stamp></Link>}
      <div><h1>{me.display_name}'s things</h1>{totals && <p>{totals.total_count} {totals.total_count===1?'thing':'things'} · <span className="cc-desktop-copy">shared </span>in {totals.shared_cache_count} {totals.shared_cache_count===1?'cache':'caches'}<span className="cc-desktop-copy"> · one stock count each</span></p>}</div>
      <Link to="/items/new" className="cc-library-new">+ New item</Link>
    </div>
    <section aria-label="Your items" className="cc-library-contents">
      <div className="cc-library-filters" role="group" aria-label="Filter your items">{filters.map(([value,wide,phone,count])=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}><span className="cc-desktop-copy">{wide}</span><span className="cc-phone-copy">{phone}</span>{count!==undefined?` ${count}`:''}</button>)}</div>
      {query.isPending && <p role="status">Loading your items…</p>}
      {query.isError && <div className="cc-read-error"><p role="alert">{errorMessage(query.error)} Previously loaded items may be out of date.</p><button type="button" onClick={()=>void query.refetch()}>Try your items again</button></div>}
      <div className="cc-packing-slip cc-library-slip"><div className="cc-library-columns" aria-hidden="true"><span /><span>Thing</span><span>Kind</span><span>Shown in</span><span>Status</span><span /></div><ul>{items.map(item=><li key={item.id} className="cc-library-row">
        <Link className="cc-library-item-main" to={`/items/${item.id}`}>{!item.caches.length && !item.photo_version ? <span className="cc-unshared-tile" aria-hidden="true" /> : <ThingTile item={item} library tone="deep" />}<strong>{item.title}</strong><span className="cc-library-kind">{item.is_consumable?`Give · ${item.quantity} left`:'Lend'}</span></Link>
        <span className="cc-library-shared">{item.caches.length ? <><span className="cc-phone-copy">{item.caches.map(cache=>cache.name).join(' · ')}</span><span className="cc-library-chips">{item.caches.map(cache=><Link to={`/caches/${cache.id}`} key={cache.id}><span style={{background:boxColor(cache.id)}} aria-hidden="true" />{cache.name}</Link>)}</span></> : <span>Not in a cache yet</span>}</span>
        <span className="cc-library-status">{!item.caches.length ? null : <><span className="cc-phone-copy"><ThingStatus item={item} pending={item.pending_count} compact /></span><span className="cc-desktop-copy"><ThingStatus item={item} pending={item.pending_count} quantityAsStatus={false} /></span></>}</span>
        <Link className={`cc-library-row-action${item.pending_count?' cc-library-review':''}${!item.caches.length?' cc-library-share':''}`} to={item.pending_count?'/requests':item.caches.length?`/items/${item.id}/edit`:`/items/${item.id}#sharing`}>{item.pending_count?'Review':item.caches.length?'Edit':<><span className="cc-desktop-copy">Share it</span><span className="cc-phone-copy">Share</span></>}<span className="sr-only"> {item.title}</span></Link>
      </li>)}</ul></div>
      {query.isSuccess && !items.length && <div className="cc-empty-slip"><p>{totals?.total_count ? 'No items match this filter.' : 'No items yet. Add something you can lend or give away.'}</p><Link to="/items/new" className="cc-text-action">+ New item</Link></div>}
      {query.hasNextPage && <button type="button" disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()} className="cc-profile-secondary cc-library-more">{query.isFetchingNextPage?'Loading…':'Load more items'}</button>}
    </section>
  </main>
}
