import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import { cacheDetailQuery } from '../lib/caches'
import { libraryItemQuery, type Item } from '../lib/items'
import { invalidateRequestViews } from '../lib/requests'
import { OnboardingPage } from './OnboardingPage'
import { ItemPhoto } from './ItemPhoto'
import { ItemRequests } from './ItemRequests'
import { Avatar } from '../components/Avatar'
import { Stamp } from '../components/Stamp'
import { ShownIn } from './ShownIn'
import { ItemSkeleton } from '../components/skeletons/ItemSkeletons'
import { useToast } from '../components/Toast'
import { ItemWaiting } from './ItemWaiting'

export function ItemAvailability({ item }: { item: Item }) {
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const isLentOut = item.available === false
  const saveAvailability = useMutation({
    mutationFn: (available: boolean) => apiFetch(`/api/me/items/${item.id}`, { method: 'PATCH', body: { available } }),
    onSuccess: (_saved, available) => showToast(available ? 'Marked as available' : 'Marked as lent out'),
    onError: error => showToast(errorMessage(error), 'error'),
    onSettled: () => invalidateRequestViews(queryClient),
  })

  return <section className="cc-item-availability" aria-label="Item availability">
    <h2>Availability</h2>
    <div className="cc-item-availability-row">
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
  const cacheItemQuery = useQuery({
    queryKey: ['item', cacheId, itemId],
    queryFn: () => apiFetch<Item>(`/api/caches/${cacheId}/items/${itemId}`),
    enabled: !!cacheId && !!me?.display_name,
  })
  const isCacheOwner = cacheItemQuery.isSuccess && cacheItemQuery.data.owner_id === me?.id
  const ownerItemQuery = useQuery({
    ...libraryItemQuery(me?.id, itemId),
    enabled: !!me?.display_name && (!cacheId || isCacheOwner),
  })
  // Cache context must succeed before switching to the owner's private detail.
  const itemQuery = cacheId && !isCacheOwner ? cacheItemQuery : ownerItemQuery
  const cacheQuery = useQuery({ ...cacheDetailQuery(cacheId), enabled: !!cacheId && !!me?.display_name })
  useEffect(() => {
    if (itemQuery.isSuccess && location.hash === '#sharing') document.getElementById('sharing')?.scrollIntoView()
  }, [itemQuery.isSuccess, location.hash])
  const backPath = cacheId ? `/caches/${cacheId}` : '/items'

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
  const editPath = cacheId ? `/caches/${cacheId}/items/${itemId}/edit` : `/items/${itemId}/edit`

  return <main className={`cc-owner-item-detail${item.active === false ? ' cc-item-detail-inactive' : ''}${!isOwner ? ' cc-member-item-detail' : ''}`}>
    <div className="cc-owner-item-layout">
      <div className="cc-owner-hero">
        <ItemPhoto key={item.photo_version} item={item} />
        <nav className="cc-owner-hero-links" aria-label="Item actions">
          <Link to={backPath}>‹ Back</Link>
          {isOwner && <Link to={editPath} state={{itemEditor:true}} data-item-editor-trigger={item.id}>Edit</Link>}
        </nav>
      </div>
      <div className="cc-owner-info">
        <div className="cc-owner-title"><h1>{item.title}</h1>
          {isOwner && item.active === false && <Stamp tone="muted">Inactive</Stamp>}
          {isOwner && <Link className="cc-owner-edit-desktop" to={editPath} state={{itemEditor:true}} data-item-editor-trigger={item.id}>Edit</Link>}
        </div>
        <p className="cc-owner-kind">{item.is_consumable ? `Give · ${item.available_quantity ?? item.quantity}` : 'Lend'}</p>
        {!isOwner && !isAvailable && <Stamp tone="muted">{item.available === false ? 'Lent out' : 'None left'}</Stamp>}
        {item.description && <section className="cc-owner-note"><h2>Note</h2><p>{item.description}</p></section>}
        {isOwner ? <>
          <ItemAvailability item={item} />
          <div id="sharing"><ShownIn item={item} compact /></div>
        </> : <>
          <section className="cc-item-from"><h2>From</h2><p>
            <Avatar userId={item.owner_id} name={item.owner_name ?? 'Member'} photoVersion={item.owner_photo_version} coat={item.owner_cat_coat} size={28} />
            {item.owner_name ?? 'Member'}
          </p></section>
          <div className="cc-detail-ask">
            <p>If {item.owner_name ?? 'the owner'} says yes, you'll both see how to reach each other.</p>
            <button type="button" disabled={!isAvailable} aria-expanded={isAskOpen} aria-haspopup="dialog" aria-controls="item-ask-sheet" onClick={() => setIsAskOpen(true)}>
              <span className="cc-desktop-copy">{item.is_consumable ? 'Ask for some' : 'Ask to borrow'}</span>
              <span className="cc-phone-copy">Ask {item.owner_name ?? 'the owner'} {item.is_consumable ? 'for some' : 'to borrow it'}</span>
            </button>
          </div>
        </>}
      </div>
      {isOwner ? <ItemWaiting item={item} pendingCount={ownerItemQuery.data?.pending_count} />
        : <aside className="cc-member-asks"><ItemRequests item={item} compact askOpen={isAskOpen} onAskClose={() => setIsAskOpen(false)} cacheName={cacheQuery.data?.name} /></aside>}
    </div>
  </main>
}
