import { useState, type RefObject } from 'react'
import { Link } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/api'
import { attachSelected, sharingHint, useLibrary } from '../lib/items'
import { invalidateRequestViews } from '../lib/requests'
import { ItemForm } from './ItemForm'

export function AddItemSheet({ cacheId, cacheName, dialog }: { cacheId: string; cacheName: string; dialog: RefObject<HTMLDialogElement | null> }) {
  const { me } = useAuth()
  const client = useQueryClient()
  const query = useLibrary(me?.display_name ? me.id : undefined)
  const [tab, setTab] = useState<'existing' | 'new'>('existing')
  const [selected, setSelected] = useState<string[]>([])
  const [attached, setAttached] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [status, setStatus] = useState('')
  const items = query.data?.pages.flatMap(page => page.items) ?? []
  const add = useMutation({
    mutationFn: () => attachSelected(selected, cacheId, id => {
      setAttached(current => [...current,id])
      setSelected(current => current.filter(value => value !== id))
    }),
    onSuccess: () => { setStatus('Items added.'); dialog.current?.close() },
    onSettled: () => invalidateRequestViews(client),
  })
  const busy = add.isPending || creating
  return <dialog ref={dialog} className="cc-add-items" aria-labelledby="add-items-heading" onCancel={event => { if (busy) event.preventDefault() }} onClose={() => { setSelected([]); setAttached([]); setStatus(''); setTab('existing'); setFormKey(key => key + 1); add.reset() }}>
    <div className="cc-sheet-grip" aria-hidden="true" />
    <div className="cc-add-items-title"><h2 id="add-items-heading" className="break-words text-xl font-semibold">Add to {cacheName}</h2><button type="button" autoFocus disabled={busy} onClick={() => dialog.current?.close()} className="cc-add-close" aria-label="Close add items">×</button></div>
    <div className="cc-add-source-tabs" role="group" aria-label="Choose item source">
      <button type="button" aria-pressed={tab === 'existing'} disabled={busy} onClick={() => setTab('existing')} className={tab === 'existing' ? 'cc-pill' : 'cc-outline'}>Your items</button>
      <button type="button" aria-pressed={tab === 'new'} disabled={busy} onClick={() => setTab('new')} className={tab === 'new' ? 'cc-pill' : 'cc-outline'}>New item</button>
    </div>
    <div hidden={tab !== 'existing'} className="cc-add-existing">
      <p className="mt-4 text-sm text-slate-600">Pick things you already own. Same item, one shared stock count.</p>
      {query.isPending && <p role="status" className="mt-4">Loading your items…</p>}
      {query.isError && <div className="mt-4"><p role="alert" className="text-red-700">{errorMessage(query.error)}</p><button type="button" className="underline" onClick={() => void query.refetch()}>Try your items again</button></div>}
      {query.isSuccess && !items.length && <p className="mt-4">No items yet. Choose New item to start your library.</p>}
      <ul className="cc-add-selection">{items.map(item => {
        const already = attached.includes(item.id) || item.caches.some(cache => cache.id === cacheId)
        return <li key={item.id} data-already={already}><label className="flex min-h-14 items-center gap-3 py-3"><input type="checkbox" checked={already || selected.includes(item.id)} disabled={already || busy} onChange={event => setSelected(current => event.target.checked ? [...current,item.id] : current.filter(id => id !== item.id))} /><span className="min-w-0"><span className="block break-words font-medium">{item.title}</span><span className="block break-words text-sm text-slate-600">{already ? 'Already here' : `${sharingHint(item,cacheId)}${item.is_consumable?` · ${item.available_quantity ?? item.quantity} to give`:''}`}</span></span></label></li>
      })}</ul>
      {query.hasNextPage && <button type="button" disabled={query.isFetchingNextPage || busy} onClick={() => void query.fetchNextPage()} className="cc-outline mt-3">{query.isFetchingNextPage ? 'Loading…' : 'Load more items'}</button>}
      {add.isError && <p role="alert" className="mt-3 text-red-700">{errorMessage(add.error)} Items already added are kept. Retry the remaining selection or find them in <Link to="/items" className="underline">Your items</Link>.</p>}
      {status && <p role="status" className="mt-3">{status}</p>}
      <button type="button" disabled={busy || !selected.length || query.isError} onClick={() => add.mutate()} className="cc-profile-primary cc-add-submit">{add.isPending ? 'Adding…' : `Add ${selected.length} to ${cacheName}`}</button>
    </div>
    <div hidden={tab !== 'new'} className="cc-add-new"><p className="mt-4 text-sm text-slate-600">Creates it in your library and shares it here in one step.</p><ItemForm key={formKey} cacheId={cacheId} embedded onBusy={setCreating} onSaved={() => { dialog.current?.close(); setTab('existing') }} onCancel={() => dialog.current?.close()} /></div>
  </dialog>
}
