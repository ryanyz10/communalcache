import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import { cacheDetailQuery } from '../lib/caches'
import { libraryItemQuery, type Item, type LibraryItem } from '../lib/items'
import { invalidateRequestViews } from '../lib/requests'
import { OnboardingPage } from './OnboardingPage'
import { ItemPhoto } from './ItemPhoto'
import { ItemRequests } from './ItemRequests'
import { Avatar } from '../components/Avatar'
import { Cat } from '../components/Cat'
import { Stamp } from '../components/Stamp'
import { boxColor } from '../components/Box'
import { ShownIn } from './ShownIn'
import { ItemSkeleton } from '../components/skeletons/ItemSkeletons'
import { useToast } from '../components/Toast'
import { ItemWaiting } from './ItemWaiting'

export function ItemAvailability({ item, compact = false }: { item: Item;compact?:boolean }) {
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const isLentOut = item.available === false
  const saveAvailability = useMutation({
    mutationFn: (available: boolean) => apiFetch(`/api/me/items/${item.id}`, { method: 'PATCH', body: { available } }),
    onSuccess: (_saved, available) => showToast(available ? 'Marked as available' : 'Marked as lent out'),
    onError: error => showToast(errorMessage(error), 'error'),
    onSettled: () => invalidateRequestViews(queryClient),
  })

  return <section className={compact ? 'cc-item-availability' : 'cc-owner-availability'} aria-label="Item availability">
    <h2>Availability</h2>
    <div className={compact ? 'cc-item-availability-row' : undefined}>
    <p role="status">{isLentOut ? 'Lent out' : 'Available'}</p>
    <button type="button" disabled={saveAvailability.isPending} className="cc-profile-secondary" onClick={() => saveAvailability.mutate(isLentOut)}>
      {saveAvailability.isPending ? 'Saving…' : isLentOut ? 'Mark as available' : 'Mark as lent out'}
    </button>
    </div>
  </section>
}

export function ItemPage() {
  const { cacheId, itemId = '' } = useParams()
  const { me } = useAuth()
  const location = useLocation()
  const [isAskOpen, setIsAskOpen] = useState(false)
  const itemQuery = useQuery<Item & Partial<Pick<LibraryItem, 'caches' | 'pending_count'>>>({
    ...(cacheId ? {
      queryKey: ['item', cacheId, itemId],
      queryFn: () => apiFetch<Item>(`/api/caches/${cacheId}/items/${itemId}`),
    } : libraryItemQuery(me?.id, itemId)),
    enabled: !!me?.display_name,
  })
  const cacheQuery = useQuery({ ...cacheDetailQuery(cacheId), enabled: !!cacheId && !!me?.display_name })
  useEffect(() => {
    if (itemQuery.isSuccess && location.hash === '#sharing') document.getElementById('sharing')?.scrollIntoView()
  }, [itemQuery.isSuccess, location.hash])
  const backPath = cacheId ? `/caches/${cacheId}` : '/items'
  const cacheName = cacheQuery.data?.name ?? 'Cache'

  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  if (itemQuery.isPending) return <ItemSkeleton cacheId={cacheId} />
  if (itemQuery.isError) return <main className="cc-page">
    <Link to={backPath}>‹ {cacheId ? 'Back to cache' : 'Your items'}</Link>
    <p role="alert" className="cc-form-error">{errorMessage(itemQuery.error)}</p>
    <button className="cc-text-action" onClick={() => void itemQuery.refetch()}>Try again</button>
  </main>

  const item = itemQuery.data
  const isOwner = item.owner_id === me.id
  const isAvailable = item.active !== false && item.available !== false && (!item.is_consumable || (item.available_quantity ?? 0) > 0)
  let availabilityLabel = 'No stock'
  if (item.active === false) availabilityLabel = 'Inactive'
  else if (isAvailable) availabilityLabel = 'Available'
  else if (item.available === false) availabilityLabel = 'Lent out'
  let contextLabel = 'Your private library'
  if (cacheId) contextLabel = cacheName
  else if (item.caches?.length) contextLabel = item.caches.map(cache => cache.name).join(' · ')
  const editPath = cacheId ? `/caches/${cacheId}/items/${itemId}/edit` : `/items/${itemId}/edit`

  if (isOwner && !cacheId) return <main className={`cc-owner-item-detail${item.active === false ? ' cc-item-detail-inactive' : ''}`}>
    <div className="cc-owner-item-layout">
      <div className="cc-owner-hero">
        <ItemPhoto key={item.photo_version} item={item} />
        <nav className="cc-owner-hero-links" aria-label="Item actions">
          <Link to="/items">‹ Back</Link>
          <Link to={editPath} state={{itemEditor:true}} data-item-editor-trigger={item.id}>Edit</Link>
        </nav>
      </div>
      <div className="cc-owner-info">
        <div className="cc-owner-title"><h1>{item.title}</h1>
          {item.active === false && <Stamp tone="muted">Inactive</Stamp>}
          <Link className="cc-owner-edit-desktop" to={editPath} state={{itemEditor:true}} data-item-editor-trigger={item.id}>Edit</Link>
        </div>
        <p className="cc-owner-kind">{item.is_consumable ? `Give · ${item.available_quantity ?? item.quantity}` : 'Lend'}</p>
        {item.description && <section className="cc-owner-note"><h2>Note</h2><p>{item.description}</p></section>}
        <ItemAvailability item={item} compact />
        <ShownIn item={item} compact />
      </div>
      <ItemWaiting item={item} pendingCount={item.pending_count} />
    </div>
  </main>

  return <main className={`organic-item-detail${item.active === false ? ' cc-item-detail-inactive' : ''}${!isOwner && cacheId ? ' cc-member-item-detail' : ''}`}>
    <nav className="cc-item-breadcrumb" aria-label="Breadcrumb">
      <Link to={backPath}>
        {cacheId && <span aria-hidden="true" style={{ background: boxColor(cacheId) }} />}
        <svg className="cc-phone-copy" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6" />
        </svg>
        {cacheId ? cacheName : 'Your items'}
      </Link>
      <span className="cc-desktop-copy">›</span>
      <span className="cc-desktop-copy">{item.title}</span>
    </nav>
    <div className="cc-organic-item-layout">
      <div className="cc-item-art">
        <span className="cc-item-owner-cat" aria-hidden="true"><Cat userId={item.owner_id} coat={item.owner_cat_coat} pose="loaf" /></span>
        <ItemPhoto key={item.photo_version} item={item} />
      </div>
      <div className="cc-organic-item-copy">
        <div className="cc-item-detail-title">
          <h1>{item.title}</h1>
          <Stamp tone={isAvailable ? 'ok' : 'muted'}>{availabilityLabel}</Stamp>
        </div>
        <dl className="cc-item-info-slip">
          <div><dt>From</dt><dd>
            <Avatar userId={item.owner_id} name={item.owner_name ?? 'Member'} photoVersion={item.owner_photo_version} coat={item.owner_cat_coat} size={28} />
            {isOwner ? 'You' : item.owner_name ?? 'Member'}
          </dd></div>
          <div><dt>Kind</dt><dd>{item.is_consumable ? `Give · ${item.available_quantity ?? item.quantity}` : 'Lend'}</dd></div>
          <div className="cc-item-context"><dt>In</dt><dd>{contextLabel}</dd></div>
          {item.description && <div className="cc-item-note"><dt>Note</dt><dd>{item.description}</dd></div>}
        </dl>
        {!isOwner && cacheId && <div className="cc-detail-ask">
          <p>If {item.owner_name ?? 'the owner'} says yes, you'll both see how to reach each other.</p>
          <button type="button" disabled={!isAvailable} aria-expanded={isAskOpen} aria-haspopup="dialog" aria-controls="item-ask-sheet" onClick={() => setIsAskOpen(true)}>
            <span className="cc-desktop-copy">{item.is_consumable ? 'Ask for some' : 'Ask to borrow'}</span>
            <span className="cc-phone-copy">Ask {item.owner_name ?? 'the owner'} {item.is_consumable ? 'for some' : 'to borrow it'}</span>
          </button>
        </div>}
        {cacheId && <ItemRequests item={item} compact askOpen={isAskOpen} onAskClose={() => setIsAskOpen(false)} cacheName={cacheQuery.data?.name} />}
        {isOwner && <div className="cc-owner-item-controls">
          <div className="cc-inline-actions">
            <Link to={editPath} state={{ itemEditor: true }} data-item-editor-trigger={item.id} className="cc-profile-primary">Edit item</Link>
          </div>
          <ItemAvailability item={item} />
          <div id="sharing"><ShownIn item={item} /></div>
          {!cacheId && <Link to="/requests" className="cc-profile-secondary">View asks in Requests</Link>}
        </div>}
      </div>
    </div>
  </main>
}
