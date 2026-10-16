import { useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import { filterContents, type CacheDetail, type CacheSummary, type ContentsFilter } from '../lib/caches'
import type { Item } from '../lib/items'
import type { JoinRequest } from '../lib/joining'
import { shareInvite } from '../lib/invites'
import { OnboardingPage } from './OnboardingPage'
import { AddItemSheet } from './AddItemSheet'
import { Avatar } from '../components/Avatar'
import { boxColor } from '../components/Box'
import { MemberCats } from '../components/MemberCats'
import { Stamp } from '../components/Stamp'
import { ThingTile, ThingStatus } from '../components/ThingTile'

function SettingsIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" aria-hidden="true"><path d="M20 7h-9M14 17H5" /><circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" /></svg>
}

export function CachePage({ itemsMoving = false }: { itemsMoving?: boolean }) {
  const { cacheId = '' } = useParams(), { me } = useAuth()
  const [status,setStatus] = useState(''), [filter,setFilter] = useState<ContentsFilter>('all'), [search,setSearch] = useState(''), [searchOpen,setSearchOpen] = useState(false)
  const addDialog = useRef<HTMLDialogElement>(null)
  const query = useQuery({ queryKey: ['cache',cacheId], queryFn: () => apiFetch<CacheDetail>(`/api/caches/${cacheId}`), enabled: !!me?.display_name })
  const caches = useQuery({ queryKey: ['caches'], queryFn: () => apiFetch<CacheSummary[]>('/api/caches'), enabled: !!me?.display_name })
  const items = useQuery({ queryKey: ['items',cacheId], queryFn: () => apiFetch<(Item & {pending_count:number})[]>(`/api/caches/${cacheId}/items`), enabled: !!me?.display_name && !itemsMoving })
  const joins = useQuery({ queryKey: ['join-requests',cacheId], queryFn: () => apiFetch<JoinRequest[]>(`/api/caches/${cacheId}/join-requests`), enabled: !!me?.display_name && query.data?.owner_id === me.id })
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  if (query.isPending) return <main className="cc-page"><p role="status">Loading cache…</p></main>
  if (query.isError) return <main className="cc-page"><Link to="/" className="cc-text-action">‹ Your caches</Link><p role="alert" className="cc-form-error">{errorMessage(query.error)}</p><button className="cc-text-action" onClick={()=>void query.refetch()}>Try again</button></main>
  const cache=query.data, owner=cache.owner_id===me.id
  const total=cache.members.reduce((sum,member)=>sum+(member.attached_item_count ?? 0),0)
  const all=items.data ?? [], visible=filterContents(all,filter,search), give=all.filter(item=>item.is_consumable).length
  const settings=`/caches/${cache.id}/settings`
  async function invite() {
    try { setStatus(await shareInvite(new URL(`/join/${cache.invite_token}`,location.origin).href)) }
    catch { setStatus('Could not share or copy. Open Cache settings to select the invite link.') }
  }
  const controls=<><button type="button" className="cc-cache-invite" onClick={()=>void invite()}>Invite</button>{!itemsMoving && <button type="button" className="cc-cache-add" onClick={()=>addDialog.current?.showModal()}>+ Add item</button>}</>
  return <main className="organic-cache">
    <div className="cc-cache-phone-nav"><Link to="/">‹ Caches</Link><Link to={settings} aria-label="Cache settings"><SettingsIcon /></Link></div>
    <div className="cc-cache-hero-wrap">
      <nav className="cc-cache-folders" aria-label="Your caches">{[cache,...(caches.isError ? [] : caches.data ?? []).filter(row=>row.id!==cache.id)].map(row=><Link key={row.id} to={`/caches/${row.id}`} aria-current={row.id===cache.id?'page':undefined} style={row.id===cache.id?{background:boxColor(cache.id),color:'#201e1d'}:undefined}>{row.name}</Link>)}</nav>
      <MemberCats members={cache.members} limit={6} />
      <div className="cc-cache-box" style={{background:boxColor(cache.id)}}><span className="cc-box-handle" aria-hidden="true" /><span className="cc-cache-up" aria-hidden="true"><Stamp>↑ This side up</Stamp></span>
        {cache.requires_approval && <span className="cc-cache-approval"><Stamp><span className="cc-desktop-copy">Owner </span>approves joins</Stamp></span>}
        <div className="cc-cache-label"><h1>{cache.name}</h1><p>{cache.members.length} {cache.members.length===1?'neighbor':'neighbors'} · {total} {total===1?'thing':'things'}{owner && <span className="cc-desktop-copy"> · you own this box</span>}</p></div>
        <div className="cc-cache-box-controls"><Link to={settings} aria-label="Cache settings"><SettingsIcon /></Link>{controls}</div>
      </div>
    </div>
    <div className="cc-cache-phone-controls">{controls}</div>
    {status && <p role="status" className="cc-cache-status">{status}</p>}
    <div className="cc-contents-layout">
      <section aria-labelledby="contents-heading" className="cc-contents">
        {itemsMoving ? <p role="status">Items are being moved, back soon</p> : <>
          <div className="cc-contents-toolbar"><h2 id="contents-heading">Contents</h2><div className="cc-contents-filters" role="group" aria-label="Filter contents">{([['all','Everything','All',all.length],['lend','To lend','To lend',all.length-give],['give','To give','To give',give]] as const).map(([value,wide,phone,count])=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>setFilter(value)}><span className="cc-desktop-copy">{wide}</span><span className="cc-phone-copy">{phone}</span>{items.isSuccess ? ` ${count}` : ''}</button>)}</div>
            <button type="button" className="cc-search-toggle" aria-label="Search contents" aria-expanded={searchOpen} onClick={()=>setSearchOpen(value=>!value)}>⌕</button>
            <label className="cc-contents-search" data-open={searchOpen}><span className="sr-only">Search contents</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg><input type="search" placeholder="Search contents" value={search} onChange={event=>setSearch(event.target.value)} /></label>
          </div>
          {items.isPending && <p role="status">Loading items…</p>}
          {items.isError && <div className="cc-read-error"><p role="alert">{errorMessage(items.error)} Previously loaded contents may be out of date.</p><button type="button" onClick={()=>void items.refetch()}>Try items again</button></div>}
          <div className="cc-packing-slip cc-contents-slip"><div className="cc-contents-columns" aria-hidden="true"><span /><span>Thing</span><span>From</span><span>Status</span><span /></div>
            <ul>{visible.map(item=><li key={item.id} className="cc-contents-row"><Link className="cc-content-main" to={`/caches/${cache.id}/items/${item.id}`}><ThingTile item={item} /><strong>{item.title}</strong><span className="cc-contents-owner"><Avatar userId={item.owner_id} name={item.owner_name ?? 'Neighbor'} coat={item.owner_cat_coat} photoVersion={item.owner_photo_version} size={26} />{item.owner_id===me.id?'You':item.owner_name ?? 'Neighbor'}</span><ThingStatus item={item} pending={item.owner_id===me.id?item.pending_count:0} /></Link>
              {item.owner_id===me.id ? !!item.pending_count && <Link className="cc-content-review" to="/requests">Review<span className="sr-only"> asks for {item.title}</span></Link> : item.available!==false && (!item.is_consumable || (item.available_quantity ?? 0)>0) && <Link className="cc-content-ask" to={`/caches/${cache.id}/items/${item.id}`}>Ask<span className="sr-only"> for {item.title}</span></Link>}
            </li>)}</ul>
          </div>
          {items.isSuccess && !visible.length && <div className="cc-empty-slip"><p>{all.length ? 'No things match your search or filter.' : 'No items yet. Add the first thing to share.'}</p>{!all.length && <button type="button" className="cc-text-action" onClick={()=>addDialog.current?.showModal()}>+ Add item</button>}</div>}
        </>}
      </section>
      <aside className="cc-in-the-box" aria-labelledby="cache-members-heading"><h2 id="cache-members-heading">In the box</h2>
        {owner && joins.isError && <div className="cc-read-error"><p role="alert">Join requests could not be loaded.</p><Link to={`${settings}#join-requests`}>Open settings to try again</Link></div>}
        {owner && !!joins.data?.length && <div className="cc-join-banner"><span>{joins.data.length} {joins.data.length===1?'person wants':'people want'} to join</span><Link to={`${settings}#join-requests`}>Review</Link></div>}
        <ul className="cc-packing-slip cc-member-list">{cache.members.map(member=><li key={member.user_id}><Avatar userId={member.user_id} name={member.display_name ?? 'Neighbor'} coat={member.cat_coat} photoVersion={member.profile_photo_version} size={32} /><strong>{member.user_id===me.id?'You':member.display_name ?? 'Neighbor'}</strong>{member.user_id===cache.owner_id && <span className="cc-owner-label">Owner</span>}<span>{member.attached_item_count} {member.attached_item_count===1?'thing':'things'}</span></li>)}</ul>
      </aside>
    </div>
    {!itemsMoving && <AddItemSheet cacheId={cache.id} cacheName={cache.name} dialog={addDialog} />}
  </main>
}
