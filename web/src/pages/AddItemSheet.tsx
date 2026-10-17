import { useState, type RefObject } from 'react'
import { Link } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/api'
import { attachSelected, sharingHint, useLibrary } from '../lib/items'
import { invalidateRequestViews } from '../lib/requests'
import { ItemForm } from './ItemForm'
import { SkeletonRows, LoadingStatus, Shimmer } from '../components/Skeleton'

type AddItemSheetProps = {
  cacheId: string
  cacheName: string
  dialog: RefObject<HTMLDialogElement | null>
}

export function AddItemSheet({ cacheId, cacheName, dialog }: AddItemSheetProps) {
  const { me } = useAuth()
  const queryClient = useQueryClient()
  const libraryQuery = useLibrary(me?.display_name ? me.id : undefined)
  const [sourceTab, setSourceTab] = useState<'existing' | 'new'>('existing')
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [attachedItemIds, setAttachedItemIds] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [formVersion, setFormVersion] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')
  const libraryItems = libraryQuery.data?.pages.flatMap(page => page.items) ?? []
  const addItems = useMutation({
    mutationFn: () => attachSelected(selectedItemIds, cacheId, itemId => {
      setAttachedItemIds(current => [...current, itemId])
      setSelectedItemIds(current => current.filter(value => value !== itemId))
    }),
    onSuccess: () => {
      setStatusMessage('Items added.')
      dialog.current?.close()
    },
    onSettled: () => invalidateRequestViews(queryClient),
  })
  const isBusy = addItems.isPending || isCreating

  return <dialog
    ref={dialog}
    className="cc-add-items"
    aria-labelledby="add-items-heading"
    onCancel={event => { if (isBusy) event.preventDefault() }}
    onClose={() => {
      setSelectedItemIds([])
      setAttachedItemIds([])
      setStatusMessage('')
      setSourceTab('existing')
      setFormVersion(version => version + 1)
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
        aria-pressed={sourceTab === 'existing'}
        disabled={isBusy}
        onClick={() => setSourceTab('existing')}
        className={sourceTab === 'existing' ? 'cc-pill' : 'cc-outline'}
      >Your items</button>
      <button
        type="button"
        aria-pressed={sourceTab === 'new'}
        disabled={isBusy}
        onClick={() => setSourceTab('new')}
        className={sourceTab === 'new' ? 'cc-pill' : 'cc-outline'}
      >New item</button>
    </div>
    <div hidden={sourceTab !== 'existing'} className="cc-add-existing">
      <p className="mt-4 text-sm text-slate-600">Pick things you already own. Same item, one shared stock count.</p>
      {libraryQuery.isPending && <SkeletonRows label="Loading your items…" kind="plain" />}
      {libraryQuery.isError && <div className="mt-4">
        <p role="alert" className="text-red-700">{errorMessage(libraryQuery.error)}</p>
        <button type="button" className="underline" onClick={() => void libraryQuery.refetch()}>Try your items again</button>
      </div>}
      {libraryQuery.isSuccess && !libraryItems.length && <p className="mt-4">No items yet. Choose New item to start your library.</p>}
      <ul className="cc-add-selection">
        {libraryItems.map(item => {
          const isAlreadyShared = attachedItemIds.includes(item.id) || item.caches.some(cache => cache.id === cacheId)
          let hint = 'Already here'
          if (!isAlreadyShared) {
            hint = sharingHint(item, cacheId)
            if (item.is_consumable) hint += ` · ${item.available_quantity ?? item.quantity} to give`
          }
          return <li key={item.id} data-already={isAlreadyShared}>
            <label className="flex min-h-14 items-center gap-3 py-3">
              <input
                type="checkbox"
                checked={isAlreadyShared || selectedItemIds.includes(item.id)}
                disabled={isAlreadyShared || isBusy}
                onChange={event => setSelectedItemIds(current => event.target.checked
                  ? [...current, item.id] : current.filter(id => id !== item.id))}
              />
              <span className="min-w-0">
                <span className="block break-words font-medium">{item.title}</span>
                <span className="block break-words text-sm text-slate-600">{hint}</span>
              </span>
            </label>
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
        {errorMessage(addItems.error)} Items already added are kept. Retry the remaining selection or find them in{' '}
        <Link to="/items" className="underline">Your items</Link>.
      </p>}
      {statusMessage && <p role="status" className="mt-3">{statusMessage}</p>}
      <button
        type="button"
        disabled={isBusy || !selectedItemIds.length || libraryQuery.isError}
        onClick={() => addItems.mutate()}
        className="cc-profile-primary cc-add-submit"
      >
        {addItems.isPending ? 'Adding…' : `Add ${selectedItemIds.length} to ${cacheName}`}
      </button>
    </div>
    <div hidden={sourceTab !== 'new'} className="cc-add-new">
      <p className="mt-4 text-sm text-slate-600">Creates it in your library and shares it here in one step.</p>
      <ItemForm
        key={formVersion}
        cacheId={cacheId}
        embedded
        onBusy={setIsCreating}
        onSaved={() => { dialog.current?.close(); setSourceTab('existing') }}
        onCancel={() => dialog.current?.close()}
      />
    </div>
  </dialog>
}
