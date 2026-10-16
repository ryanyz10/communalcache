import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Shimmer, LoadingStatus, LoadingLines, SkeletonRows } from './Skeleton'
import { MemberCats } from './MemberCats'
import { Stamp } from './Stamp'
import { boxColor } from './Box'
import { WideBreadcrumbs } from './WideBreadcrumbs'
import { COATS } from '../lib/cats'
import { Cat } from './Cat'
import { SupportCard } from './Support'
import { PeekControls } from '../pages/PeekControls'
import type { Me } from '../lib/api'
import { greeting, startSlowNotice, type CacheSummary } from '../lib/caches'

export function CacheSettingsIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" aria-hidden="true"><path d="M20 7h-9M14 17H5" /><circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" /></svg>
}

export function CacheLoadingChips({ slow }: { slow: boolean }) {
  return slow ? <p role="status" className="cc-cache-slow"><span aria-hidden="true" />Still loading. This is taking longer than usual.</p> : <div className="cc-skeleton-filter-chips" aria-hidden="true"><Shimmer width={62} height={33} /><Shimmer width={92} height={33} /><Shimmer width={86} height={33} /></div>
}

export function CacheContentsSkeleton() {
  const [slow, setSlow] = useState(false)
  useEffect(() => startSlowNotice(() => setSlow(true)), [])
  return <div className="cc-skeleton-cache-contents" aria-busy="true">
    <div className="cc-contents-toolbar"><h2>Contents</h2><CacheLoadingChips slow={slow} /><span className="cc-contents-search" aria-hidden="true">Search contents</span></div>
    <div className="cc-packing-slip cc-contents-slip cc-skeleton-table"><div className="cc-contents-columns" aria-hidden="true"><span /><span>Thing</span><span>From</span><span>Status</span><span /></div><SkeletonRows label="Loading items…" /></div>
  </div>
}

export function CacheErrorCard({ message, retry }: { message: string; retry: () => void }) {
  return <div className="cc-cache-state-card" role="alert"><Stamp tone="warn">RETURN TO SENDER</Stamp><h2>Couldn't open this box</h2><p>Check your connection and try again. Nothing in the cache has changed.</p><span className="sr-only">{message}</span><button type="button" className="cc-profile-primary" onClick={retry}>Try again</button></div>
}

export function CacheEmptyCard({ onAdd }: { onAdd: () => void }) {
  return <div className="cc-cache-state-card cc-cache-empty-card"><h2>Nothing in here yet</h2><p>Add something you're happy to lend or give away, and everyone in the box will see it here.</p><button type="button" className="cc-profile-primary" onClick={onAdd}>+ Add the first thing</button></div>
}

export function CacheSkeleton({ cacheId, summary, caches = [], viewerId, error }: { cacheId: string; summary?: CacheSummary; caches?: CacheSummary[]; viewerId?: string; error?: { message: string; retry: () => void } }) {
  const controls = <><button type="button" disabled className="cc-cache-invite">Invite</button><button type="button" disabled className="cc-cache-add">+ Add item</button></>
  if (error && !summary) return <main className="organic-cache"><Link to="/" className="cc-text-action">‹ Your caches</Link><CacheErrorCard {...error} /></main>
  return <main className="organic-cache cc-page-skeleton" data-skeleton="cache" aria-busy={!error}>
    {!error && <LoadingStatus label="Loading cache…" />}
    <div className="cc-cache-phone-nav"><Link to="/">‹ Caches</Link><span className="cc-skeleton-settings-icon" aria-hidden="true"><CacheSettingsIcon /></span></div>
    <div className="cc-cache-hero-wrap">
      <nav className="cc-cache-folders" aria-label="Your caches">{summary ? [summary, ...caches.filter(cache => cache.id !== cacheId)].map(cache => <Link key={cache.id} to={`/caches/${cache.id}`} aria-current={cache.id === cacheId ? 'page' : undefined} style={cache.id === cacheId ? { background: boxColor(cacheId), color: '#201e1d' } : undefined}>{cache.name}</Link>) : <span className="cc-skeleton-folder"><Shimmer width={140} height={18} /></span>}</nav>
      {summary && <MemberCats members={summary.member_preview ?? []} total={summary.active_member_count} />}
      <div className="cc-cache-box" style={{ background: boxColor(cacheId) }}><span className="cc-box-handle" aria-hidden="true" /><span className="cc-cache-up" aria-hidden="true"><Stamp>↑ This side up</Stamp></span>{summary?.requires_approval && <span className="cc-cache-approval"><Stamp><span className="cc-desktop-copy">Owner </span>approves joins</Stamp></span>}<div className="cc-cache-label"><h1>{summary?.name ?? <Shimmer width="65%" height={40} />}</h1>{summary ? <p>{summary.active_member_count} {summary.active_member_count === 1 ? 'neighbor' : 'neighbors'} · {summary.attached_item_count} {summary.attached_item_count === 1 ? 'thing' : 'things'}{viewerId === summary.owner_id && <span className="cc-desktop-copy"> · you own this box</span>}</p> : <Shimmer width="38%" height={12} />}</div><div className="cc-cache-box-controls"><Link to={`/caches/${cacheId}/settings`} aria-label="Cache settings"><CacheSettingsIcon /></Link>{controls}</div></div>
    </div>
    <div className="cc-cache-phone-controls">{controls}</div>
    <div className="cc-contents-layout"><section className="cc-contents">{error ? <><div className="cc-contents-toolbar cc-cache-state-toolbar"><h2>Contents</h2></div><CacheErrorCard {...error} /></> : <CacheContentsSkeleton />}</section>{!error && <aside className="cc-in-the-box"><h2>In the box</h2><SkeletonRows label="Loading members…" kind="members" count={summary?.active_member_count ?? 4} /></aside>}</div>
  </main>
}

export function HomeBoxesSkeleton() {
  return <div className="cc-home-boxes cc-skeleton-boxes"><LoadingStatus label="Loading caches…" />{[0, 1, 2].map(index => <div className="cc-labelled-cache" key={index}><div className="cc-box cc-skeleton-home-box"><span className="cc-box-handle" /><Shimmer width="76%" height={30} /><Shimmer width="48%" height={12} /></div></div>)}</div>
}

export function HomeSkeleton() {
  return <main className="organic-home cc-page-skeleton" data-skeleton="home" aria-busy="true"><button type="button" disabled className="cc-home-plus" aria-label="New cache or join with an invite"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg></button><div className="cc-home-title"><div><p>{greeting(new Date().getHours())}</p><h1>Your caches</h1></div><div className="cc-home-desktop-actions"><button disabled className="cc-profile-secondary">Join with an invite</button><button disabled className="cc-profile-primary">+ New cache</button></div></div><HomeBoxesSkeleton /><div className="cc-home-slips"><section><div className="cc-slip-title"><h2>Your things</h2></div><SkeletonRows label="Loading your items…" count={3} kind="library" /></section><section><div className="cc-slip-title"><h2>Your asks</h2></div><SkeletonRows label="Loading your asks…" count={2} kind="requests" /></section></div></main>
}

export function LibrarySkeleton({ user, filter = 'all', pendingAnswerCount }: { user?: Me; filter?: string; pendingAnswerCount?: number }) {
  return <main className="organic-library cc-page-skeleton" data-skeleton="library" aria-busy="true">
    <div className="cc-library-hero">
      {user && <span className="cc-library-cat" aria-hidden="true"><Cat userId={user.id} coat={user.cat_coat} pose="sit" /></span>}
      <span className="cc-box-handle" />
      {!!pendingAnswerCount && <span className="cc-library-asks"><Stamp tone="warn">{pendingAnswerCount} {pendingAnswerCount === 1 ? 'ask' : 'asks'}<span className="cc-desktop-copy"> waiting</span></Stamp></span>}
      <div><h1>{user?.display_name ? `${user.display_name}'s things` : 'Your items'}</h1><Shimmer width={180} height={14} /></div><span className="cc-library-new">+ New item</span>
    </div>
    <section className="cc-library-contents">
      <div className="cc-library-filters">{[['all', 'All', 'All'], ['lend', 'To lend', 'Lend'], ['give', 'To give', 'Give'], ['unshared', 'Not shared yet', 'Not shared']].map(([value, wide, phone]) => <button disabled aria-pressed={filter === value} key={value}><span className="cc-desktop-copy">{wide}</span><span className="cc-phone-copy">{phone}</span></button>)}</div>
      <div className="cc-library-slip"><SkeletonRows label="Loading your items…" kind="library" /></div>
    </section>
  </main>
}

export function ItemSkeleton({ cacheId }: { cacheId?: string }) {
  return <main className="organic-item-detail cc-page-skeleton" data-skeleton="item" aria-busy="true">
    <LoadingStatus label="Loading item…" />
    <nav className="cc-item-breadcrumb"><Link to={cacheId ? `/caches/${cacheId}` : '/items'}>‹ {cacheId ? 'Back to cache' : 'Your items'}</Link></nav>
    <div className="cc-organic-item-layout"><div className="cc-item-art"><Shimmer height={200} className="cc-item-photo-frame cc-skeleton-item-photo" /></div><div className="cc-organic-item-copy">
      <Shimmer width="78%" height={36} />
      <dl className="cc-item-info-slip">{['From', 'Kind', 'In', 'Note'].map(label => <div key={label} className={label === 'In' ? 'cc-item-context' : undefined}><dt>{label}</dt><dd><Shimmer width={150} height={14} /></dd></div>)}</dl>
      {cacheId ? <SkeletonRows label="Loading requests…" count={2} kind="requests" /> : <div className="cc-owner-item-controls">
        <div className="cc-inline-actions"><button disabled className="cc-profile-primary">Edit item</button><button disabled className="cc-profile-secondary cc-delete-item">Delete item</button></div>
        <section className="cc-owner-availability"><h2>Availability</h2><div className="cc-owner-availability-toggle"><span>Lent out</span><Shimmer width={48} height={28} /></div><span>Lent out note (optional)</span><Shimmer height={50} /><p className="cc-form-hint">Up to 200 characters. This blocks new requests, not existing pending requests.</p><button disabled className="cc-profile-secondary">Save availability</button></section>
        <section className="cc-owner-sharing"><h2>Shown in</h2><p className="cc-form-hint">Choose which caches can see this item. Stock and availability are shared everywhere.</p><SkeletonRows label="Loading sharing…" kind="plain" count={2} /></section>
        <section className="cc-owner-photo"><h2>Photo</h2><Shimmer height={48} /><LoadingLines label="Loading photo…" /></section>
      </div>}
    </div></div>
  </main>
}

export function ItemEditorSkeleton({ editing = false }: { editing?: boolean }) {
  return <main className="organic-item-editor cc-page-skeleton" data-skeleton="editor" aria-busy="true">
    <LoadingStatus label="Loading item form…" />
    <div className="cc-item-editor-nav"><button disabled>Cancel</button><h1>{editing ? 'Edit item' : 'New item'}</h1><button disabled>Save</button></div>
    <div className="cc-item-fields">
      {!editing && <Shimmer height={150} className="cc-skeleton-field" />}
      <Shimmer height={editing ? 20 : 46} />
      <div className="cc-item-title-field"><label>What is it?</label><Shimmer height={50} /></div>
      {editing ? <div className="cc-item-description-editor"><span>Description (optional)</span><Shimmer height={90} className="cc-skeleton-field" /></div> : <><span>Put it in</span><Shimmer width="76%" height={38} /></>}
    </div>
  </main>
}

export function RequestsSkeleton({ embedded = false, pendingAnswerCount }: { embedded?: boolean; pendingAnswerCount?: number }) {
  const columns = <div className="cc-request-columns"><div className="cc-request-owned">{['Needs your answer', 'Answered for your things'].map((label, index) => <section className="cc-request-group" key={label}><div className="cc-request-group-heading"><h2>{label}</h2>{index === 0 && !!pendingAnswerCount && <span>{pendingAnswerCount}</span>}</div><SkeletonRows label={`Loading ${label.toLowerCase()}…`} count={index === 0 ? 2 : 1} kind="requests" /></section>)}</div><section className="cc-request-group"><div className="cc-request-group-heading"><h2>Your asks</h2></div><SkeletonRows label="Loading your asks…" count={2} kind="requests" /></section></div>
  return embedded ? columns : <main className="organic-requests cc-page-skeleton" data-skeleton="requests" aria-busy="true"><h1>Requests</h1>{columns}</main>
}

export function RequestDetailSkeleton({ embedded = false }: { embedded?: boolean }) {
  const body = <><div className="cc-approved-item"><Shimmer height={150} className="cc-approved-name-tile" /></div><div className="cc-approved-copy"><Shimmer width="86%" height={38} /><LoadingLines label="Loading ask…" /><div className="cc-focused-contact"><Shimmer width="48%" height={12} /><Shimmer height={44} /></div></div></>
  return embedded ? body : <main className="organic-request-detail cc-page-skeleton" data-skeleton="request-detail" aria-busy="true"><nav className="cc-request-back"><Link to="/requests">‹ Requests</Link></nav>{body}</main>
}

export function AccountSkeleton() {
  return <main className="cc-account-page cc-page-skeleton" data-skeleton="account" aria-busy="true">
    <LoadingStatus label="Loading account…" />
    <div className="cc-account-layout"><section className="cc-account-profile"><h1>Account</h1>
      <div className="cc-profile-label"><div className="cc-profile-label-header"><span>FROM</span><Shimmer width="55%" height={20} /></div><div className="cc-profile-label-body">
        <div className="cc-profile-photo-row"><Shimmer width={52} height={52} round /><span>Profile photo</span></div>
        <div className="cc-account-coats"><fieldset className="cc-coat-picker cc-coat-picker-names"><legend>Your cat</legend><div className="cc-coat-options">{COATS.map(coat => <span className="cc-coat-option" key={coat.key}><Shimmer width={52} height={52} round /><span className="cc-coat-name">{coat.name}</span></span>)}</div></fieldset></div>
        {['Display name', 'Email'].map(label => <div className="cc-profile-field" key={label}><div><strong>{label}</strong><Shimmer width={170} height={14} /></div></div>)}
      </div></div>
    </section><div className="cc-account-settings">
      <section className="cc-account-contact"><div className="cc-contact-heading"><h2>How to reach me</h2></div><p className="cc-contact-value-mobile"><Shimmer width={170} height={18} /></p><p className="cc-contact-helper-desktop">Shown only after an ask is approved, while both of you are active in that cache.</p><p className="cc-contact-helper-mobile">Shown only after an ask is approved.</p><div className="cc-contact-summary"><Shimmer width={170} height={18} /></div></section>
      <div className="cc-account-options">
        <section className="cc-account-push"><div className="cc-push-summary"><div><h2><span className="cc-push-title-desktop">Notifications on this device</span><span className="cc-push-title-mobile">Push notifications</span></h2><p><span className="cc-push-title-desktop">Push notifications. Otherwise you get email.</span><span className="cc-push-title-mobile">On this device. Otherwise email.</span></p></div><Shimmer width={48} height={28} /></div><LoadingLines label="Loading notification configuration…" /></section>
        <PeekControls />
        <section className="cc-account-session"><p>Session</p><button disabled className="cc-profile-secondary">Sign out</button><span className="cc-session-mobile-hint">This browser</span></section>
        <SupportCard />
      </div>
    </div></div>
  </main>
}

export function CacheSettingsSkeleton({ cacheId }: { cacheId: string }) {
  return <main className="cc-page cc-cache-settings-page cc-page-skeleton" data-skeleton="cache-settings" aria-busy="true">
    <WideBreadcrumbs><Link to="/">Caches</Link><span aria-hidden="true">›</span><Shimmer width={130} height={14} /><span aria-hidden="true">›</span><span>Settings</span></WideBreadcrumbs>
    <Link to={`/caches/${cacheId}`} className="text-sm underline lg:hidden">‹ Back to cache</Link><h1 className="mt-3 text-2xl font-semibold tracking-tight lg:text-[28px] lg:font-bold">Cache settings</h1>
    <div className="contents lg:mt-6 lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start lg:gap-8"><nav aria-label="Settings sections" className="hidden lg:flex lg:flex-col lg:gap-3"><span>Members</span><span>Invite link</span><Shimmer width={70} height={16} /></nav><div className="contents lg:block lg:min-w-0 lg:space-y-5">{['Members', 'Invite link'].map(label => <section className="mt-6 lg:mt-0" key={label}><h2 className="cc-section-title">{label}</h2><SkeletonRows label={`Loading ${label.toLowerCase()}…`} count={label === 'Members' ? 3 : 1} kind="members" /></section>)}</div></div>
  </main>
}

export function RouteSkeleton({ pathname }: { pathname: string }) {
  const cacheId = pathname.match(/^\/caches\/([^/]+)/)?.[1]
  if (/\/items\/(?:new|[^/]+\/edit)$/.test(pathname)) return <ItemEditorSkeleton editing={pathname.endsWith('/edit')} />
  if (/\/items\/[^/]+$/.test(pathname)) return <ItemSkeleton cacheId={cacheId} />
  if (cacheId) return pathname.endsWith('/settings') ? <CacheSettingsSkeleton cacheId={cacheId} /> : <CacheSkeleton cacheId={cacheId} />
  if (pathname === '/items') return <LibrarySkeleton />
  if (pathname.startsWith('/requests/')) return <RequestDetailSkeleton />
  if (pathname === '/requests') return <RequestsSkeleton />
  if (pathname === '/account') return <AccountSkeleton />
  return <HomeSkeleton />
}
