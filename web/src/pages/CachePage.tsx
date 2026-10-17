import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import {
  cacheDetailQuery, cacheItemsQuery, filterContents,
  type CacheSummary, type ContentsFilter,
} from '../lib/caches'
import type { JoinRequest } from '../lib/joining'
import { shareInvite } from '../lib/invites'
import { OnboardingPage } from './OnboardingPage'
import { AddItemSheet } from './AddItemSheet'
import { Avatar } from '../components/Avatar'
import { boxColor } from '../components/Box'
import { MemberCats } from '../components/MemberCats'
import { Stamp } from '../components/Stamp'
import { ThingTile, ThingStatus } from '../components/ThingTile'
import {
  CacheSkeleton, CacheContentsSkeleton, CacheErrorCard, CacheEmptyCard, CacheSettingsIcon,
} from '../components/skeletons/CacheSkeleton'

export function CachePage({ itemsMoving = false }: { itemsMoving?: boolean }) {
  const { cacheId = '' } = useParams()
  const { me } = useAuth()
  const [inviteStatus, setInviteStatus] = useState('')
  const [contentsFilter, setContentsFilter] = useState<ContentsFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const addItemDialog = useRef<HTMLDialogElement>(null)
  const cacheQuery = useQuery({ ...cacheDetailQuery(cacheId), enabled: !!me?.display_name })
  const cachesQuery = useQuery({
    queryKey: ['caches'],
    queryFn: () => apiFetch<CacheSummary[]>('/api/caches'),
    enabled: !!me?.display_name,
  })
  const itemsQuery = useQuery({
    ...cacheItemsQuery(cacheId),
    enabled: !!me?.display_name && !itemsMoving,
  })
  const joinRequestsQuery = useQuery({
    queryKey: ['join-requests', cacheId],
    queryFn: () => apiFetch<JoinRequest[]>(`/api/caches/${cacheId}/join-requests`),
    enabled: !!me?.display_name && cacheQuery.data?.owner_id === me.id,
  })
  const [startedWithSkeleton] = useState(cacheQuery.isPending || itemsQuery.isPending)
  const [showPlaceholder, setShowPlaceholder] = useState(startedWithSkeleton)
  const isLoadingCacheData = cacheQuery.isPending || (!itemsMoving && itemsQuery.isPending)

  useEffect(() => {
    if (isLoadingCacheData || !showPlaceholder) return
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 200 : 350
    const timer = setTimeout(() => setShowPlaceholder(false), duration)
    return () => clearTimeout(timer)
  }, [isLoadingCacheData, showPlaceholder])

  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  if (cacheQuery.isPending) return <CacheSkeleton
    cacheId={cacheId}
    summary={cachesQuery.data?.find(cache => cache.id === cacheId)}
    caches={cachesQuery.data}
    viewerId={me.id}
  />
  if (cacheQuery.isError) return <CacheSkeleton
    cacheId={cacheId}
    summary={cachesQuery.data?.find(cache => cache.id === cacheId)}
    caches={cachesQuery.data}
    viewerId={me.id}
    error={{
      message: errorMessage(cacheQuery.error),
      retry: () => { void cacheQuery.refetch(); void itemsQuery.refetch() },
    }}
  />

  const cache = cacheQuery.data
  const isOwner = cache.owner_id === me.id
  const attachedItemCount = cache.members.reduce((sum, member) => sum + (member.attached_item_count ?? 0), 0)
  const cacheItems = itemsQuery.data ?? []
  const filteredItems = filterContents(cacheItems, contentsFilter, searchTerm)
  const consumableItemCount = cacheItems.filter(item => item.is_consumable).length
  const settingsPath = `/caches/${cache.id}/settings`
  const otherCaches = (cachesQuery.isError ? [] : cachesQuery.data ?? []).filter(row => row.id !== cache.id)

  async function shareCacheInvite() {
    try { setInviteStatus(await shareInvite(new URL(`/join/${cache.invite_token}`, location.origin).href)) }
    catch { setInviteStatus('Could not share or copy. Open Cache settings to select the invite link.') }
  }

  const cacheControls = <>
    <button type="button" className="cc-cache-invite" onClick={() => void shareCacheInvite()}>Invite</button>
    {!itemsMoving && <button
      type="button"
      className="cc-cache-add"
      onClick={() => addItemDialog.current?.showModal()}
    >
      + Add item
    </button>}
  </>

  let contents: ReactNode
  if (itemsMoving) {
    contents = <p role="status">Items are being moved, back soon</p>
  } else if (itemsQuery.isPending) {
    contents = <CacheContentsSkeleton />
  } else if (itemsQuery.isError) {
    contents = <>
      <div className="cc-contents-toolbar cc-cache-state-toolbar"><h2>Contents</h2></div>
      <CacheErrorCard message={errorMessage(itemsQuery.error)} retry={() => void itemsQuery.refetch()} />
    </>
  } else if (!cacheItems.length) {
    contents = <>
      <div className="cc-contents-toolbar cc-cache-state-toolbar"><h2>Contents</h2></div>
      <CacheEmptyCard onAdd={() => addItemDialog.current?.showModal()} />
    </>
  } else {
    const filterOptions = [
      ['all', 'Everything', 'All', cacheItems.length],
      ['lend', 'To lend', 'To lend', cacheItems.length - consumableItemCount],
      ['give', 'To give', 'To give', consumableItemCount],
    ] as const

    contents = <div className="cc-cache-swap-region">
      {showPlaceholder && <div className="cc-cache-skeleton-exit" aria-hidden="true" inert>
        <CacheContentsSkeleton />
      </div>}
      <div className="cc-contents-toolbar">
        <h2 id="contents-heading">Contents</h2>
        <div className="cc-contents-filters" role="group" aria-label="Filter contents">
          {filterOptions.map(([value, wide, phone, count]) => <button
            key={value}
            type="button"
            aria-pressed={contentsFilter === value}
            onClick={() => setContentsFilter(value)}
          >
            <span className="cc-desktop-copy">{wide}</span>
            <span className="cc-phone-copy">{phone}</span>
            {itemsQuery.isSuccess ? ` ${count}` : ''}
          </button>)}
        </div>
        <button
          type="button"
          className="cc-search-toggle"
          aria-label="Search contents"
          aria-expanded={isSearchOpen}
          onClick={() => setIsSearchOpen(value => !value)}
        >
          ⌕
        </button>
        <label className="cc-contents-search" data-open={isSearchOpen}>
          <span className="sr-only">Search contents</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            placeholder="Search contents"
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
          />
        </label>
      </div>
      <div className={`cc-packing-slip cc-contents-slip${startedWithSkeleton ? ' cc-skeleton-swap' : ''}`}>
        <div className="cc-contents-columns" aria-hidden="true">
          <span /><span>Thing</span><span>From</span><span>Status</span><span />
        </div>
        <ul>
          {filteredItems.map((item, index) => {
            const isItemOwner = item.owner_id === me.id
            const canAsk = item.available !== false && (!item.is_consumable || (item.available_quantity ?? 0) > 0)
            return <li
              key={item.id}
              className="cc-contents-row"
              style={startedWithSkeleton ? { animationDelay: `${Math.min(index + 1, 4) * 80}ms` } : undefined}
            >
              <Link className="cc-content-main" to={`/caches/${cache.id}/items/${item.id}`}>
                <ThingTile item={item} />
                <strong>{item.title}</strong>
                <span className="cc-contents-owner">
                  <Avatar
                    userId={item.owner_id}
                    name={item.owner_name ?? 'Neighbor'}
                    coat={item.owner_cat_coat}
                    photoVersion={item.owner_photo_version}
                    size={26}
                  />
                  {isItemOwner ? 'You' : item.owner_name ?? 'Neighbor'}
                </span>
                <ThingStatus item={item} pending={isItemOwner ? item.pending_count : 0} />
              </Link>
              {isItemOwner ? !!item.pending_count && <Link className="cc-content-review" to="/requests">
                Review<span className="sr-only"> asks for {item.title}</span>
              </Link> : canAsk && <Link className="cc-content-ask" to={`/caches/${cache.id}/items/${item.id}`}>
                Ask<span className="sr-only"> for {item.title}</span>
              </Link>}
            </li>
          })}
        </ul>
      </div>
      {itemsQuery.isSuccess && !filteredItems.length && <div className="cc-empty-slip">
        <p>No things match your search or filter.</p>
      </div>}
    </div>
  }

  return <main className="organic-cache">
    <div className="cc-cache-phone-nav">
      <Link to="/">‹ Caches</Link>
      <Link to={settingsPath} aria-label="Cache settings"><CacheSettingsIcon /></Link>
    </div>
    <div className="cc-cache-hero-wrap">
      <nav className="cc-cache-folders" aria-label="Your caches">
        {[cache, ...otherCaches].map(row => <Link
          key={row.id}
          to={`/caches/${row.id}`}
          aria-current={row.id === cache.id ? 'page' : undefined}
          style={row.id === cache.id ? { background: boxColor(cache.id), color: '#201e1d' } : undefined}
        >
          {row.name}
        </Link>)}
      </nav>
      <MemberCats members={cache.members} limit={6} />
      <div className="cc-cache-box" style={{ background: boxColor(cache.id) }}>
        <span className="cc-box-handle" aria-hidden="true" />
        <span className="cc-cache-up" aria-hidden="true"><Stamp>↑ This side up</Stamp></span>
        {cache.requires_approval && <span className="cc-cache-approval">
          <Stamp><span className="cc-desktop-copy">Owner </span>approves joins</Stamp>
        </span>}
        <div className="cc-cache-label">
          <h1>{cache.name}</h1>
          <p>
            {cache.members.length} {cache.members.length === 1 ? 'neighbor' : 'neighbors'}
            {' · '}
            {attachedItemCount} {attachedItemCount === 1 ? 'thing' : 'things'}
            {isOwner && <span className="cc-desktop-copy"> · you own this box</span>}
          </p>
        </div>
        <div className="cc-cache-box-controls">
          <Link to={settingsPath} aria-label="Cache settings"><CacheSettingsIcon /></Link>
          {cacheControls}
        </div>
      </div>
    </div>
    <div className="cc-cache-phone-controls">{cacheControls}</div>
    {inviteStatus && <p role="status" className="cc-cache-status">{inviteStatus}</p>}
    <div className="cc-contents-layout">
      <section aria-label="Contents" className="cc-contents">{contents}</section>
      <aside className="cc-in-the-box" aria-labelledby="cache-members-heading">
        <h2 id="cache-members-heading">In the box</h2>
        {isOwner && joinRequestsQuery.isError && <div className="cc-read-error">
          <p role="alert">Join requests could not be loaded.</p>
          <Link to={`${settingsPath}#join-requests`}>Open settings to try again</Link>
        </div>}
        {isOwner && !!joinRequestsQuery.data?.length && <div className="cc-join-banner">
          <span>{joinRequestsQuery.data.length} {joinRequestsQuery.data.length === 1 ? 'person wants' : 'people want'} to join</span>
          <Link to={`${settingsPath}#join-requests`}>Review</Link>
        </div>}
        <ul className="cc-packing-slip cc-member-list">
          {cache.members.map(member => <li key={member.user_id}>
            <Avatar
              userId={member.user_id}
              name={member.display_name ?? 'Neighbor'}
              coat={member.cat_coat}
              photoVersion={member.profile_photo_version}
              size={32}
            />
            <strong>{member.user_id === me.id ? 'You' : member.display_name ?? 'Neighbor'}</strong>
            {member.user_id === cache.owner_id && <span className="cc-owner-label">Owner</span>}
            <span>{member.attached_item_count} {member.attached_item_count === 1 ? 'thing' : 'things'}</span>
          </li>)}
        </ul>
      </aside>
    </div>
    {!itemsMoving && <AddItemSheet cacheId={cache.id} cacheName={cache.name} dialog={addItemDialog} />}
  </main>
}
