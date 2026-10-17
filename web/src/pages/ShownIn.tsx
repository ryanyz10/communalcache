import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import type { CacheSummary } from '../lib/caches'
import { libraryItemQuery, type Item, type LibraryItem } from '../lib/items'
import { invalidateRequestViews } from '../lib/requests'
import { SkeletonRows } from '../components/Skeleton'

export function ShownIn({ item }: { item: Item }) {
  const { me } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const detachDialog = useRef<HTMLDialogElement>(null)
  const [detachTarget, setDetachTarget] = useState<CacheSummary | null>(null)
  const libraryItem = useQuery({ ...libraryItemQuery(me?.id, item.id), enabled: !!me?.display_name })
  const cachesQuery = useQuery({
    queryKey: ['caches'],
    queryFn: () => apiFetch<CacheSummary[]>('/api/caches'),
    enabled: !!me?.display_name,
  })
  const changeSharing = useMutation({
    mutationFn: ({ cache, checked }: { cache: CacheSummary; checked: boolean }) => apiFetch<void>(
      `/api/me/items/${item.id}/attachments/${cache.id}`, { method: checked ? 'PUT' : 'DELETE' },
    ),
    onSuccess: async (_, { cache, checked }) => {
      queryClient.setQueryData<LibraryItem>(['library-item', me?.id, item.id], current => {
        if (!current) return current
        const otherCaches = current.caches.filter(row => row.id !== cache.id)
        const nextCaches = checked ? [...otherCaches, cache] : otherCaches
        return { ...current, caches: nextCaches }
      })
      detachDialog.current?.close()
      if (!checked && item.cache_id === cache.id) navigate(`/items/${item.id}`, { replace: true })
    },
    onSettled: () => invalidateRequestViews(queryClient),
  })
  const readError = libraryItem.error ?? cachesQuery.error

  return <section className="cc-owner-sharing" aria-labelledby="shown-in-heading">
    <h2 id="shown-in-heading" className="text-xl font-semibold">Shown in</h2>
    <p className="mt-1 text-sm text-slate-600">Choose which caches can see this item. Stock and availability are shared everywhere.</p>
    {(libraryItem.isPending || cachesQuery.isPending) && <SkeletonRows label="Loading sharing…" kind="plain" count={2} />}
    {readError && <div className="mt-3">
      <p role="alert" className="text-red-700">{errorMessage(readError)}</p>
      <button type="button" className="underline" onClick={() => {
        void libraryItem.refetch()
        void cachesQuery.refetch()
      }}>Try sharing again</button>
    </div>}
    {!readError && libraryItem.data && cachesQuery.data && <>
      {!cachesQuery.data.length && <p className="mt-3 text-slate-600">
        You aren't in any caches yet. Your item stays private in your library.{' '}
        <Link to="/" className="underline">Go to Home</Link> to create a cache or join with an invite.
      </p>}
      <ul className="mt-3 divide-y divide-slate-100">
        {cachesQuery.data.map(cache => {
          const isShared = libraryItem.data.caches.some(row => row.id === cache.id)
          return <li key={cache.id}>
            <label className="flex min-h-12 items-center gap-3 py-2">
              <input type="checkbox" checked={isShared} disabled={changeSharing.isPending} onChange={event => {
                changeSharing.reset()
                if (event.target.checked) changeSharing.mutate({ cache, checked: true })
                else {
                  setDetachTarget(cache)
                  detachDialog.current?.showModal()
                }
              }} />
              <span className="break-words">{cache.name}</span>
            </label>
          </li>
        })}
      </ul>
    </>}
    {changeSharing.isPending && <p role="status" className="mt-2">Updating sharing…</p>}
    {changeSharing.isError && <p role="alert" className="mt-2 text-red-700">
      {errorMessage(changeSharing.error)} Could not confirm sharing. Refresh or try the checkbox again.
    </p>}
    {changeSharing.isSuccess && <p role="status" className="mt-2 text-emerald-700">Sharing saved.</p>}
    <dialog
      ref={detachDialog}
      onCancel={event => { if (changeSharing.isPending) event.preventDefault() }}
      className="cc-item-confirm"
      aria-labelledby="detach-item-heading"
    >
      <h2 id="detach-item-heading" className="break-words text-xl font-semibold">Stop sharing in {detachTarget?.name}?</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li>The item is removed from this cache only.</li>
        <li>Pending asks in this cache get declined and requesters are notified.</li>
        <li>Your library item, photos, stock and other caches are kept.</li>
      </ul>
      {changeSharing.isError && <p role="alert" className="mt-3 text-red-700">
        {errorMessage(changeSharing.error)} You can retry here.
      </p>}
      <div className="mt-6 flex gap-3">
        <button type="button" autoFocus disabled={changeSharing.isPending} onClick={() => detachDialog.current?.close()} className="cc-outline">
          Cancel
        </button>
        <button
          type="button"
          disabled={changeSharing.isPending || !detachTarget}
          onClick={() => { if (detachTarget) changeSharing.mutate({ cache: detachTarget, checked: false }) }}
          className="cc-pill"
        >
          {changeSharing.isPending ? 'Saving…' : 'Confirm stop sharing'}
        </button>
      </div>
    </dialog>
  </section>
}
