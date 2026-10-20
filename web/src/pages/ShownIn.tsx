import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import type { CacheSummary } from '../lib/caches'
import { libraryItemQuery, type Item, type LibraryItem } from '../lib/items'
import { invalidateRequestViews } from '../lib/requests'
import { SkeletonRows } from '../components/Skeleton'
import { useToast } from '../components/Toast'

export function ShownIn({ item }: { item: Item }) {
  const { me } = useAuth()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const detachDialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState<string[] | null>(null)
  const libraryItem = useQuery({ ...libraryItemQuery(me?.id, item.id), enabled: !!me?.display_name })
  const cachesQuery = useQuery({
    queryKey: ['caches'],
    queryFn: () => apiFetch<CacheSummary[]>('/api/caches'),
    enabled: !!me?.display_name,
  })
  const savedIds = libraryItem.data?.caches.map(cache => cache.id) ?? []
  const selectedIds = draft ?? savedIds
  const added = cachesQuery.data?.filter(cache => selectedIds.includes(cache.id) && !savedIds.includes(cache.id)) ?? []
  // Remove the current route's attachment last so a partial failure stays retryable here.
  const removed = libraryItem.data?.caches.filter(cache => !selectedIds.includes(cache.id))
    .sort((a,b) => Number(a.id === item.cache_id) - Number(b.id === item.cache_id)) ?? []
  const hasChanges = added.length > 0 || removed.length > 0
  const changeSharing = useMutation({
    mutationFn: async ({ added, removed }: { added: LibraryItem['caches']; removed: LibraryItem['caches'] }) => {
      const operations = [...added.map(cache => ({cache, checked:true})), ...removed.map(cache => ({cache, checked:false}))]
      for (const {cache, checked} of operations) {
        try {
          await apiFetch<void>(`/api/me/items/${item.id}/attachments/${cache.id}`, { method: checked ? 'PUT' : 'DELETE' })
        } catch (error) {
          throw new Error(`Couldn't save sharing for ${cache.name}. ${errorMessage(error)}`)
        }
        queryClient.setQueryData<LibraryItem>(['library-item', me?.id, item.id], current => {
          if (!current) return current
          const otherCaches = current.caches.filter(row => row.id !== cache.id)
          return { ...current, caches: checked ? [...otherCaches, cache] : otherCaches }
        })
      }
    },
    onSuccess: (_, changes) => {
      setDraft(null)
      detachDialog.current?.close()
      if (changes.removed.some(cache => cache.id === item.cache_id)) navigate(`/items/${item.id}`, { replace: true })
      showToast('Saved')
    },
    onError: error => showToast(error.message, 'error'),
    onSettled: () => invalidateRequestViews(queryClient),
  })
  const readError = libraryItem.error ?? cachesQuery.error

  function save() {
    if (!hasChanges || changeSharing.isPending) return
    changeSharing.reset()
    if (removed.length) detachDialog.current?.showModal()
    else changeSharing.mutate({ added, removed })
  }

  return <section className="cc-owner-sharing" aria-labelledby="shown-in-heading">
    <h2 id="shown-in-heading" className="text-xl font-semibold">Shown in</h2>
    <p className="mt-1 text-sm text-slate-600">Choose which caches can see this item, then Save. Stock and availability are shared everywhere.</p>
    {(libraryItem.isPending || cachesQuery.isPending) && <SkeletonRows label="Loading sharing…" kind="plain" count={2} />}
    {readError && <div className="mt-3">
      <p role="alert" className="text-red-700">{errorMessage(readError)}</p>
      <button type="button" className="underline" onClick={() => {
        void libraryItem.refetch()
        void cachesQuery.refetch()
      }}>Try sharing again</button>
    </div>}
    {!readError && libraryItem.data && cachesQuery.data && <>
      <ul className="cc-select-options mt-3">
        {!cachesQuery.data.length && <li className="cc-list-empty">
          You aren't in any caches yet. Your item stays private in your library.{' '}
          <Link to="/" className="underline">Go to Home</Link> to create a cache or join with an invite.
        </li>}
        {cachesQuery.data.map(cache => <li key={cache.id}>
          <button type="button" className="cc-select-pill" aria-pressed={selectedIds.includes(cache.id)} disabled={changeSharing.isPending} onClick={() => {
            changeSharing.reset()
            setDraft(current => {
              const ids = current ?? savedIds
              return ids.includes(cache.id) ? ids.filter(id => id !== cache.id) : [...ids, cache.id]
            })
          }}>{cache.name}</button>
        </li>)}
      </ul>
      {hasChanges && <div className="cc-inline-actions">
        <button type="button" className="cc-profile-primary" disabled={changeSharing.isPending} onClick={save}>{changeSharing.isPending ? 'Saving…' : 'Save'}</button>
        <button type="button" className="cc-profile-secondary" disabled={changeSharing.isPending} onClick={() => { setDraft(null); changeSharing.reset() }}>Cancel</button>
      </div>}
    </>}
    {changeSharing.isPending && <p role="status" className="mt-2">Updating sharing…</p>}
    {changeSharing.isError && <p role="alert" className="mt-2 text-red-700">
      {changeSharing.error.message} Successful changes are kept. Retry Save for the remaining changes, or Cancel to keep the current saved set.
    </p>}
    <dialog
      ref={detachDialog}
      onCancel={event => { if (changeSharing.isPending) event.preventDefault() }}
      className="cc-item-confirm"
      aria-labelledby="detach-item-heading"
    >
      <h2 id="detach-item-heading" className="break-words text-xl font-semibold">Stop sharing in these caches?</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5">{removed.map(cache => <li key={cache.id}>{cache.name}</li>)}</ul>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li>The item is removed from these caches only. Added caches are saved first.</li>
        <li>Pending asks in these caches get declined and requesters are notified.</li>
        <li>Your library item, photos, stock and other caches are kept.</li>
      </ul>
      {changeSharing.isError && <p role="alert" className="mt-3 text-red-700">{changeSharing.error.message} You can retry here.</p>}
      <div className="mt-6 flex gap-3">
        <button type="button" autoFocus disabled={changeSharing.isPending} onClick={() => detachDialog.current?.close()} className="cc-outline">Cancel</button>
        <button type="button" disabled={changeSharing.isPending || !hasChanges || !!readError} onClick={() => changeSharing.mutate({ added, removed })} className="cc-pill">
          {changeSharing.isPending ? 'Saving…' : 'Confirm stop sharing'}
        </button>
      </div>
    </dialog>
  </section>
}
