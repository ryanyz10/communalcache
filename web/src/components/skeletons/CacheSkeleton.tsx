import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Shimmer, LoadingStatus, SkeletonRows } from '../Skeleton'
import { MemberCats } from '../MemberCats'
import { Stamp } from '../Stamp'
import { boxColor } from '../Box'
import { WideBreadcrumbs } from '../WideBreadcrumbs'
import { startSlowNotice, type CacheSummary } from '../../lib/caches'

const UNKNOWN_TITLE_WIDTH = '65%'
const UNKNOWN_COUNTS_WIDTH = '38%'
const FALLBACK_MEMBER_ROWS = 4

type CacheSkeletonProps = {
  cacheId: string
  summary?: CacheSummary
  caches?: CacheSummary[]
  viewerId?: string
  error?: { message: string; retry: () => void }
}

export function CacheSettingsIcon() {
  return <svg
    width="19"
    height="19"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.75"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M20 7h-9M14 17H5" />
    <circle cx="17" cy="17" r="3" />
    <circle cx="7" cy="7" r="3" />
  </svg>
}

export function CacheLoadingChips({ slow }: { slow: boolean }) {
  if (slow) return <p role="status" className="cc-cache-slow">
    <span aria-hidden="true" />Still loading. This is taking longer than usual.
  </p>

  return <div className="cc-skeleton-filter-chips" aria-hidden="true">
    <Shimmer width={62} height={33} />
    <Shimmer width={92} height={33} />
    <Shimmer width={86} height={33} />
  </div>
}

export function CacheContentsSkeleton() {
  const [slow, setSlow] = useState(false)
  useEffect(() => startSlowNotice(() => setSlow(true)), [])

  return <div className="cc-skeleton-cache-contents" aria-busy="true">
    <div className="cc-contents-toolbar">
      <h2>Contents</h2>
      <CacheLoadingChips slow={slow} />
      <span className="cc-contents-search" aria-hidden="true">Search contents</span>
    </div>
    <div className="cc-packing-slip cc-contents-slip cc-skeleton-table">
      <div className="cc-contents-columns" aria-hidden="true">
        <span />
        <span>Thing</span>
        <span>From</span>
        <span>Status</span>
        <span />
      </div>
      <SkeletonRows label="Loading items…" />
    </div>
  </div>
}

export function CacheErrorCard({ message, retry }: { message: string; retry: () => void }) {
  return <div className="cc-cache-state-card" role="alert">
    <Stamp tone="warn">RETURN TO SENDER</Stamp>
    <h2>Couldn't open this box</h2>
    <p>Check your connection and try again. Nothing in the cache has changed.</p>
    <span className="sr-only">{message}</span>
    <button type="button" className="cc-profile-primary" onClick={retry}>Try again</button>
  </div>
}

export function CacheEmptyCard({ onAdd }: { onAdd: () => void }) {
  return <div className="cc-cache-state-card cc-cache-empty-card">
    <h2>Nothing in here yet</h2>
    <p>Add something you're happy to lend or give away, and everyone in the box will see it here.</p>
    <button type="button" className="cc-profile-primary" onClick={onAdd}>+ Add the first thing</button>
  </div>
}

export function CacheSkeleton({ cacheId, summary, caches = [], viewerId, error }: CacheSkeletonProps) {
  const controls = <>
    <button type="button" disabled className="cc-cache-invite">Invite</button>
    <button type="button" disabled className="cc-cache-add">+ Add item</button>
  </>

  if (error && !summary) return <main className="organic-cache">
    <Link to="/" className="cc-text-action">‹ Your caches</Link>
    <CacheErrorCard {...error} />
  </main>

  return <main className="organic-cache cc-page-skeleton" data-skeleton="cache" aria-busy={!error}>
    {!error && <LoadingStatus label="Loading cache…" />}
    <div className="cc-cache-phone-nav">
      <Link to="/">‹ Caches</Link>
      <span className="cc-skeleton-settings-icon" aria-hidden="true"><CacheSettingsIcon /></span>
    </div>
    <div className="cc-cache-hero-wrap">
      <nav className="cc-cache-folders" aria-label="Your caches">
        {summary ? [summary, ...caches.filter(cache => cache.id !== cacheId)].map(cache => <Link
          key={cache.id}
          to={`/caches/${cache.id}`}
          aria-current={cache.id === cacheId ? 'page' : undefined}
          style={cache.id === cacheId ? { background: boxColor(cacheId), color: '#201e1d' } : undefined}
        >
          {cache.name}
        </Link>) : <span className="cc-skeleton-folder"><Shimmer width={140} height={18} /></span>}
      </nav>
      {summary && <MemberCats members={summary.member_preview ?? []} total={summary.active_member_count} />}
      <div className="cc-cache-box" style={{ background: boxColor(cacheId) }}>
        <span className="cc-box-handle" aria-hidden="true" />
        <span className="cc-cache-up" aria-hidden="true"><Stamp>↑ This side up</Stamp></span>
        {summary?.requires_approval && <span className="cc-cache-approval">
          <Stamp><span className="cc-desktop-copy">Owner </span>approves joins</Stamp>
        </span>}
        <div className="cc-cache-label">
          <h1>{summary?.name ?? <Shimmer width={UNKNOWN_TITLE_WIDTH} height={40} />}</h1>
          {summary ? <p>
            {summary.active_member_count} {summary.active_member_count === 1 ? 'neighbor' : 'neighbors'}
            {' · '}
            {summary.attached_item_count} {summary.attached_item_count === 1 ? 'thing' : 'things'}
            {viewerId === summary.owner_id && <span className="cc-desktop-copy"> · you own this box</span>}
          </p> : <Shimmer width={UNKNOWN_COUNTS_WIDTH} height={12} />}
        </div>
        <div className="cc-cache-box-controls">
          <Link to={`/caches/${cacheId}/settings`} aria-label="Cache settings"><CacheSettingsIcon /></Link>
          {controls}
        </div>
      </div>
    </div>
    <div className="cc-cache-phone-controls">{controls}</div>
    <div className="cc-contents-layout">
      <section className="cc-contents">
        {error ? <>
          <div className="cc-contents-toolbar cc-cache-state-toolbar"><h2>Contents</h2></div>
          <CacheErrorCard {...error} />
        </> : <CacheContentsSkeleton />}
      </section>
      {!error && <aside className="cc-in-the-box">
        <h2>In the box</h2>
        <SkeletonRows
          label="Loading members…"
          kind="members"
          count={summary?.active_member_count ?? FALLBACK_MEMBER_ROWS}
        />
      </aside>}
    </div>
  </main>
}

export function CacheSettingsSkeleton({ cacheId }: { cacheId: string }) {
  return <main
    className="cc-page cc-cache-settings-page cc-page-skeleton"
    data-skeleton="cache-settings"
    aria-busy="true"
  >
    <WideBreadcrumbs>
      <Link to="/">Caches</Link>
      <span aria-hidden="true">›</span>
      <Shimmer width={130} height={14} />
      <span aria-hidden="true">›</span>
      <span>Settings</span>
    </WideBreadcrumbs>
    <Link to={`/caches/${cacheId}`} className="text-sm underline lg:hidden">‹ Back to cache</Link>
    <h1 className="mt-3 text-2xl font-semibold tracking-tight lg:text-[28px] lg:font-bold">Cache settings</h1>
    <div className="contents lg:mt-6 lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start lg:gap-8">
      <nav aria-label="Settings sections" className="hidden lg:flex lg:flex-col lg:gap-3">
        <span>Members</span>
        <span>Invite link</span>
        <Shimmer width={70} height={16} />
      </nav>
      <div className="contents lg:block lg:min-w-0 lg:space-y-5">
        {['Members', 'Invite link'].map(label => <section className="mt-6 lg:mt-0" key={label}>
          <h2 className="cc-section-title">{label}</h2>
          <SkeletonRows
            label={`Loading ${label.toLowerCase()}…`}
            count={label === 'Members' ? 3 : 1}
            kind="members"
          />
        </section>)}
      </div>
    </div>
  </main>
}
