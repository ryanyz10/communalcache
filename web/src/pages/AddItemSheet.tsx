import { useState, type RefObject } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/api'
import { attachSelected, sharingHint, useLibrary } from '../lib/items'
import { invalidateRequestViews } from '../lib/requests'
import { SkeletonRows, LoadingStatus, Shimmer } from '../components/Skeleton'
import { useToast } from '../components/Toast'
import { transientActionFailure } from '../lib/feedback'

type AddItemSheetProps = {
  cacheId: string
  cacheName: string
  dialog: RefObject<HTMLDialogElement | null>
}

export function AddItemSheet({ cacheId, cacheName, dialog }: AddItemSheetProps) {
  const { me } = useAuth()
  const queryClient = useQueryClient()
  const libraryQuery = useLibrary(me?.display_name ? me.id : undefined)
  const navigate = useNavigate()
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [attachedItemIds, setAttachedItemIds] = useState<string[]>([])
  const { showToast } = useToast()
  const libraryItems = libraryQuery.data?.pages.flatMap(page => page.items) ?? []
  const addItems = useMutation({
    mutationFn: () => attachSelected(selectedItemIds, cacheId, itemId => {
      setAttachedItemIds(current => [...current, itemId])
      setSelectedItemIds(current => current.filter(value => value !== itemId))
    }),
    onSuccess: () => {
      showToast('Items added.')
      dialog.current?.close()
    },
    onError: error => { if (transientActionFailure(error)) showToast(errorMessage(error), 'error') },
    onSettled: () => invalidateRequestViews(queryClient),
  })
  const isBusy = addItems.isPending

  return <dialog
    ref={dialog}
    className="cc-add-items"
    aria-labelledby="add-items-heading"
    onCancel={event => { if (isBusy) event.preventDefault() }}
    onClose={() => {
      setSelectedItemIds([])
      setAttachedItemIds([])
      addItems.reset()
    }}
  >
    <div className="cc-sheet-grip" aria-hidden="true" />
    <div className="cc-add-items-title">
      <h2 id="add-items-heading" className="break-words text-xl font-semibold">Add to {cacheName}</h2>
      <button
        type="button"
        autoFocus
        disabled={isBusy}
        onClick={() => dialog.current?.close()}
        className="cc-add-close"
        aria-label="Close add items"
      >×</button>
    </div>
    <div className="cc-add-source-tabs" role="group" aria-label="Choose item source">
      <button
        type="button"
        aria-pressed={true}
        disabled={isBusy}
        className="cc-pill"
      >Your items</button>
      <button
        type="button"
        aria-haspopup="dialog"
        disabled={isBusy}
        onClick={() => {
          if (selectedItemIds.length && !window.confirm('Leave the remaining item selection? Items already added are kept.')) return
          dialog.current?.close()
          navigate(`/caches/${cacheId}/items/new`, { state: { itemEditor: true } })
        }}
        className="cc-outline"
      >New item</button>
    </div>
    <div className="cc-add-existing">
      <p className="mt-4 text-sm text-slate-600">Pick things you already own. Same item, one shared stock count.</p>
      {libraryQuery.isPending && <SkeletonRows label="Loading your items…" kind="plain" />}
      {libraryQuery.isError && <div className="mt-4">
        <p role="alert" className="text-red-700">{errorMessage(libraryQuery.error)}</p>
        <button type="button" className="underline" onClick={() => void libraryQuery.refetch()}>Try your items again</button>
      </div>}
      <ul className="cc-add-selection">
        {libraryQuery.isSuccess && !libraryItems.length && <li className="cc-list-empty">No items yet. Choose New item to start your library.</li>}
        {libraryItems.map(item => {
          const isAlreadyShared = attachedItemIds.includes(item.id) || item.caches.some(cache => cache.id === cacheId)
          let hint = 'Already here'
          if (!isAlreadyShared) {
            hint = sharingHint(item, cacheId)
            if (item.is_consumable) hint += ` · Give · ${item.available_quantity ?? item.quantity}`
          }
          return <li key={item.id} data-already={isAlreadyShared}>
            <button
              type="button"
              className="cc-select-row"
              aria-pressed={isAlreadyShared || selectedItemIds.includes(item.id)}
              disabled={isAlreadyShared || isBusy}
              onClick={() => setSelectedItemIds(current => current.includes(item.id)
                ? current.filter(id => id !== item.id) : [...current, item.id])}
            >
              <span>{item.title}</span>
              <span>{hint}</span>
            </button>
          </li>
        })}
      </ul>
      {libraryQuery.hasNextPage && <button
        type="button"
        disabled={libraryQuery.isFetchingNextPage || isBusy}
        onClick={() => void libraryQuery.fetchNextPage()}
        className="cc-outline mt-3"
      >
        {libraryQuery.isFetchingNextPage ? <><LoadingStatus label="Loading more items…" /><Shimmer width={110} height={18} /></> : 'Load more items'}
      </button>}
      {addItems.isError && <p role="alert" className="mt-3 text-red-700">
        {!transientActionFailure(addItems.error) && errorMessage(addItems.error)} Items already added are kept. Retry the remaining selection or find them in{' '}
        <Link to="/items" className="underline">Your items</Link>.
      </p>}
      <button
        type="button"
        disabled={isBusy || !selectedItemIds.length || libraryQuery.isError}
        onClick={() => addItems.mutate()}
        className="cc-profile-primary cc-add-submit"
      >
        {addItems.isPending ? 'Adding…' : `Add ${selectedItemIds.length} to ${cacheName}`}
      </button>
    </div>
  </dialog>
}
