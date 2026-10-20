import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import { cacheDetailQuery } from '../lib/caches'
import { libraryItemQuery, type Item, type LibraryItem } from '../lib/items'
import { invalidateRequestViews } from '../lib/requests'
import { OnboardingPage } from './OnboardingPage'
import { ItemPhoto, PhotoUpload } from './ItemPhoto'
import { ItemRequests } from './ItemRequests'
import { Avatar } from '../components/Avatar'
import { Cat } from '../components/Cat'
import { Stamp } from '../components/Stamp'
import { boxColor } from '../components/Box'
import { ShownIn } from './ShownIn'
import { ItemSkeleton } from '../components/skeletons/ItemSkeletons'
import { useToast } from '../components/Toast'
import { transientActionFailure } from '../lib/feedback'

function DeleteItem({ item }: { item: Item }) {
  const { showToast } = useToast()
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const deleteItem = useMutation({
    mutationFn: () => apiFetch<void>(`/api/me/items/${item.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      deleteDialog.current?.close()
      navigate('/items')
      queryClient.removeQueries({ queryKey: ['item'] })
      queryClient.removeQueries({ queryKey: ['library-item'] })
      queryClient.removeQueries({ queryKey: ['item-requests'] })
      await invalidateRequestViews(queryClient)
      showToast('Item deleted.')
    },
    onError: error => { if (transientActionFailure(error)) showToast(errorMessage(error), 'error') },
  })

  return <>
    <button type="button" className="cc-profile-secondary cc-delete-item" onClick={() => {
      deleteItem.reset()
      deleteDialog.current?.showModal()
    }}>Delete item</button>
    <dialog
      ref={deleteDialog}
      className="cc-item-confirm"
      aria-labelledby="delete-item-heading"
      onCancel={event => { if (deleteItem.isPending) event.preventDefault() }}
    >
      <h2 id="delete-item-heading">Delete {item.title} everywhere?</h2>
      <ul>
        <li>This permanently removes the item from your library and every cache.</li>
        <li>Its request history is erased. Neighbors with pending requests will be notified.</li>
        <li>Its private photos are queued for cleanup.</li>
      </ul>
      {deleteItem.isError && !transientActionFailure(deleteItem.error) && <p role="alert" className="cc-form-error">{errorMessage(deleteItem.error)}</p>}
      <div className="cc-inline-actions">
        <button type="button" autoFocus disabled={deleteItem.isPending} className="cc-profile-secondary" onClick={() => deleteDialog.current?.close()}>
          Cancel
        </button>
        <button type="button" disabled={deleteItem.isPending} className="cc-profile-primary" onClick={() => deleteItem.mutate()}>
          {deleteItem.isPending ? 'Deleting…' : 'Confirm deletion'}
        </button>
      </div>
    </dialog>
  </>
}

function ItemAvailability({ item }: { item: Item }) {
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const [isLentOut, setIsLentOut] = useState(item.available === false)
  const [note, setNote] = useState(item.unavailable_note ?? '')
  const trimmedNote = note.trim()
  const noteTooLong = [...trimmedNote].length > 200
  const saveAvailability = useMutation({
    mutationFn: () => apiFetch(`/api/me/items/${item.id}`, {
      method: 'PATCH', body: { available: !isLentOut, unavailable_note: trimmedNote || null },
    }),
    onSuccess: () => showToast('Availability saved.'),
    onError: error => { if (transientActionFailure(error)) showToast(errorMessage(error), 'error') },
    onSettled: () => invalidateRequestViews(queryClient),
  })

  function submitAvailability(event: FormEvent) {
    event.preventDefault()
    if (!noteTooLong) saveAvailability.mutate()
  }

  return <form className="cc-owner-availability" onSubmit={submitAvailability} aria-label="Item availability">
    <h2>Availability</h2>
    <label className="cc-owner-availability-toggle">
      <span>Lent out</span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={isLentOut}
        checked={isLentOut}
        disabled={saveAvailability.isPending}
        onChange={event => setIsLentOut(event.target.checked)}
        className="cc-switch"
      />
    </label>
    <label htmlFor="unavailable-note">Lent out note (optional)</label>
    <input id="unavailable-note" value={note} disabled={saveAvailability.isPending} onChange={event => setNote(event.target.value)} className="cc-profile-input" />
    <p className="cc-form-hint">Up to 200 characters. This blocks new requests, not existing pending requests.</p>
    {noteTooLong && <p role="alert" className="cc-form-error">Keep the note within 200 characters.</p>}
    {saveAvailability.isError && !transientActionFailure(saveAvailability.error) && <p role="alert" className="cc-form-error">{errorMessage(saveAvailability.error)}</p>}
    <button type="submit" disabled={saveAvailability.isPending || noteTooLong} className="cc-profile-secondary">
      {saveAvailability.isPending ? 'Saving…' : 'Save availability'}
    </button>
  </form>
}

export function ItemPage() {
  const { cacheId, itemId = '' } = useParams()
  const { me } = useAuth()
  const location = useLocation()
  const [isAskOpen, setIsAskOpen] = useState(false)
  const itemQuery = useQuery<Item & Partial<Pick<LibraryItem, 'caches'>>>({
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
  const isAvailable = item.available !== false && (!item.is_consumable || (item.available_quantity ?? 0) > 0)
  let availabilityLabel = 'No stock'
  if (isAvailable) availabilityLabel = 'Available'
  else if (item.available === false) availabilityLabel = 'Lent out'
  let contextLabel = 'Your private library'
  if (cacheId) contextLabel = cacheName
  else if (item.caches?.length) contextLabel = item.caches.map(cache => cache.name).join(' · ')
  const editPath = cacheId ? `/caches/${cacheId}/items/${itemId}/edit` : `/items/${itemId}/edit`

  return <main className={`organic-item-detail${!isOwner && cacheId ? ' cc-member-item-detail' : ''}`}>
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
          <div><dt>Kind</dt><dd>{item.is_consumable ? `Give · ${item.available_quantity ?? item.quantity} to give right now` : 'Lend · it comes back'}</dd></div>
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
            <DeleteItem item={item} />
          </div>
          <ItemAvailability key={`${item.id}:${item.available}:${item.unavailable_note ?? ''}`} item={item} />
          <div id="sharing"><ShownIn key={item.id} item={item} /></div>
          <PhotoUpload item={item} />
          {!cacheId && <Link to="/requests" className="cc-profile-secondary">View asks in Requests</Link>}
        </div>}
      </div>
    </div>
  </main>
}
