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
  const client = useQueryClient(), navigate = useNavigate(), dialog = useRef<HTMLDialogElement>(null)
  const [target, setTarget] = useState<CacheSummary | null>(null)
  const detail = useQuery({ ...libraryItemQuery(me?.id,item.id), enabled: !!me?.display_name })
  const caches = useQuery({ queryKey: ['caches'], queryFn: () => apiFetch<CacheSummary[]>('/api/caches'), enabled: !!me?.display_name })
  const change = useMutation({
    mutationFn: ({ cache, checked }: { cache: CacheSummary; checked: boolean }) => apiFetch<void>(`/api/me/items/${item.id}/attachments/${cache.id}`, { method: checked ? 'PUT' : 'DELETE' }),
    onSuccess: async (_, { cache, checked }) => {
      client.setQueryData<LibraryItem>(['library-item',me?.id,item.id], current => current ? { ...current, caches: checked ? [...current.caches.filter(row => row.id !== cache.id),cache] : current.caches.filter(row => row.id !== cache.id) } : current)
      dialog.current?.close()
      if (!checked && item.cache_id === cache.id) navigate(`/items/${item.id}`, { replace: true })
    },
    onSettled: () => invalidateRequestViews(client),
  })
  const error = detail.error ?? caches.error
  return <section className="cc-owner-sharing" aria-labelledby="shown-in-heading">
    <h2 id="shown-in-heading" className="text-xl font-semibold">Shown in</h2>
    <p className="mt-1 text-sm text-slate-600">Choose which caches can see this item. Stock and availability are shared everywhere.</p>
    {(detail.isPending || caches.isPending) && <SkeletonRows label="Loading sharing…" kind="plain" count={2} />}
    {error && <div className="mt-3"><p role="alert" className="text-red-700">{errorMessage(error)}</p><button type="button" className="underline" onClick={() => { void detail.refetch(); void caches.refetch() }}>Try sharing again</button></div>}
    {!error && detail.data && caches.data && <>
      {!caches.data.length && <p className="mt-3 text-slate-600">You aren't in any caches yet. Your item stays private in your library. <Link to="/" className="underline">Go to Home</Link> to create a cache or join with an invite.</p>}
      <ul className="mt-3 divide-y divide-slate-100">{caches.data.map(cache => {
        const checked = detail.data.caches.some(row => row.id === cache.id)
        return <li key={cache.id}><label className="flex min-h-12 items-center gap-3 py-2"><input type="checkbox" checked={checked} disabled={change.isPending} onChange={event => {
          change.reset()
          if (event.target.checked) change.mutate({ cache, checked: true })
          else { setTarget(cache); dialog.current?.showModal() }
        }} /><span className="break-words">{cache.name}</span></label></li>
      })}</ul>
    </>}
    {change.isPending && <p role="status" className="mt-2">Updating sharing…</p>}
    {change.isError && <p role="alert" className="mt-2 text-red-700">{errorMessage(change.error)} Could not confirm sharing. Refresh or try the checkbox again.</p>}
    {change.isSuccess && <p role="status" className="mt-2 text-emerald-700">Sharing saved.</p>}
    <dialog ref={dialog} onCancel={event => { if (change.isPending) event.preventDefault() }} className="cc-item-confirm" aria-labelledby="detach-item-heading">
      <h2 id="detach-item-heading" className="break-words text-xl font-semibold">Stop sharing in {target?.name}?</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5"><li>The item is removed from this cache only.</li><li>Pending asks in this cache get declined and requesters are notified.</li><li>Your library item, photos, stock and other caches are kept.</li></ul>
      {change.isError && <p role="alert" className="mt-3 text-red-700">{errorMessage(change.error)} You can retry here.</p>}
      <div className="mt-6 flex gap-3"><button type="button" autoFocus disabled={change.isPending} onClick={() => dialog.current?.close()} className="cc-outline">Cancel</button><button type="button" disabled={change.isPending || !target} onClick={() => { if (target) change.mutate({ cache: target, checked: false }) }} className="cc-pill">{change.isPending ? 'Saving…' : 'Confirm stop sharing'}</button></div>
    </dialog>
  </section>
}
