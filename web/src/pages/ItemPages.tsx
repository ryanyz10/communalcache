import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import type { CacheDetail } from '../lib/caches'
import type { Item } from '../lib/items'
import { OnboardingPage } from './OnboardingPage'
import { ItemPhoto, PhotoUpload } from './ItemPhoto'
import { ItemRequests } from './RequestsPage'
import { WideBreadcrumbs } from '../components/WideBreadcrumbs'

export function ItemList({ cacheId }: { cacheId: string }) {
  const query = useQuery({ queryKey: ['items', cacheId], queryFn: () => apiFetch<Item[]>(`/api/caches/${cacheId}/items`) })
  return <section className="mt-6" aria-labelledby="items-heading">
    <div className="flex items-center justify-between gap-3 lg:hidden">
      <h2 id="items-heading" className="text-xl font-semibold">Shared things</h2>
      <Link to={`/caches/${cacheId}/items/new`} className="cc-pill">+ Add item</Link>
    </div>
    {query.isPending && <p role="status" className="mt-4">Loading items…</p>}
    {query.isError && <div className="mt-4"><p role="alert" className="text-red-700">{errorMessage(query.error)}</p><button className="mt-2 underline" onClick={() => void query.refetch()}>Try items again</button></div>}
    {query.isSuccess && (query.data.length ? <ul className="cc-list mt-3 lg:mt-0 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] lg:gap-4 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent">{query.data.map(item => <li key={item.id} className="border-t border-slate-100 first:border-t-0 lg:border-0">
      <Link to={`/caches/${cacheId}/items/${item.id}`} className="flex items-center gap-3 px-4 py-3.5 lg:block lg:h-full lg:overflow-hidden lg:rounded-[14px] lg:border lg:border-slate-200 lg:bg-white lg:p-0">
        <ItemPhoto key={item.photo_version} item={item} thumbnail />
        <div className="min-w-0 flex-1 lg:px-3.5 lg:py-3"><h3 className="break-words font-semibold">{item.title}</h3>
        <p className="text-sm text-slate-600">{item.owner_name ?? 'Member'} · {item.is_consumable ? `${item.quantity} in stock` : 'Reusable'}</p></div><span aria-hidden="true" className="text-xl leading-none text-slate-500 lg:hidden">›</span>
      </Link>
    </li>)}<li className="hidden lg:block"><Link to={`/caches/${cacheId}/items/new`} className="lg:flex lg:h-full lg:min-h-[120px] lg:items-center lg:justify-center lg:rounded-[14px] lg:border-2 lg:border-dashed lg:border-slate-300 lg:font-semibold lg:text-slate-600">+ Add item</Link></li></ul> : <p className="mt-4 text-slate-600">Nothing shared yet. Add the first item for your neighbors.</p>)}
    {query.isSuccess && !query.data.length && <Link to={`/caches/${cacheId}/items/new`} className="hidden lg:mt-4 lg:flex lg:min-h-[120px] lg:items-center lg:justify-center lg:rounded-[14px] lg:border-2 lg:border-dashed lg:border-slate-300 lg:font-semibold lg:text-slate-600">+ Add item</Link>}
  </section>
}

function DeleteItem({ item }: { item: Item }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const client = useQueryClient()
  const navigate = useNavigate()
  const remove = useMutation({
    mutationFn: () => apiFetch<void>(`/api/caches/${item.cache_id}/items/${item.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      dialog.current?.close()
      client.removeQueries({ queryKey: ['item', item.cache_id, item.id] })
      client.removeQueries({ queryKey: ['item-requests', item.cache_id, item.id] })
      await Promise.all([client.invalidateQueries({ queryKey: ['items', item.cache_id] }), client.invalidateQueries({ queryKey: ['requests'] })])
      navigate(`/caches/${item.cache_id}`)
    },
  })
  return <>
    <button type="button" className="ml-3 mt-6 rounded-full border border-red-300 px-3.5 py-1.5 text-sm font-medium text-red-800" onClick={() => { remove.reset(); dialog.current?.showModal() }}>Delete item</button>
    <dialog ref={dialog} onCancel={event => { if (remove.isPending) event.preventDefault() }} className="w-[calc(100%-2rem)] max-w-md rounded-lg bg-white p-6 text-slate-900" aria-labelledby="delete-item-heading">
      <h2 id="delete-item-heading" className="text-xl font-semibold">Delete {item.title}?</h2>
      <p className="mt-3">This permanently removes the item, its photos and request history. Neighbors with pending requests will be notified.</p>
      {remove.isError && <p role="alert" className="mt-3 text-red-700">{errorMessage(remove.error)}</p>}
      <div className="mt-6 flex gap-3">
        <button type="button" autoFocus disabled={remove.isPending} onClick={() => dialog.current?.close()} className="rounded-md border border-slate-300 px-4 py-2">Cancel</button>
        <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()} className="rounded-md bg-red-700 px-4 py-2 text-white disabled:opacity-60">{remove.isPending ? 'Deleting…' : 'Confirm deletion'}</button>
      </div>
    </dialog>
  </>
}

export function ItemPage({ requestsDisabled = false, deletionDisabled = false }: { requestsDisabled?: boolean; deletionDisabled?: boolean }) {
  const { cacheId = '', itemId = '' } = useParams()
  const { me } = useAuth()
  const query = useQuery({ queryKey: ['item', cacheId, itemId], queryFn: () => apiFetch<Item>(`/api/caches/${cacheId}/items/${itemId}`), enabled: !!me?.display_name })
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  return <main className="cc-page lg:max-w-[1120px] lg:p-8">
    <WideBreadcrumbs><Link to="/">Caches</Link><span aria-hidden="true">›</span><Link to={`/caches/${cacheId}`}>Cache</Link>{query.data && <><span aria-hidden="true">›</span><span>{query.data.title}</span></>}</WideBreadcrumbs>
    <Link to={`/caches/${cacheId}`} className="text-sm underline lg:hidden">‹ Back to cache</Link>
    {query.isPending && <p role="status" className="mt-4">Loading item…</p>}
    {query.isError && <div className="mt-4"><p role="alert" className="text-red-700">{errorMessage(query.error)}</p><button className="mt-2 underline" onClick={() => void query.refetch()}>Try again</button></div>}
    {query.isSuccess && <div className="contents lg:mt-4 lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr] lg:items-start lg:gap-x-10">
      <h1 className="mt-4 break-words text-2xl font-semibold tracking-tight lg:col-start-2 lg:row-start-1 lg:mt-0 lg:text-[28px] lg:font-bold">{query.data.title}</h1>
      <p className="mt-2 text-slate-600 lg:col-start-2 lg:row-start-2">Shared by {query.data.owner_name ?? 'Member'}</p>
      <div className="contents lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:block"><ItemPhoto key={query.data.photo_version} item={query.data} /></div>
      <div className="contents lg:col-start-2 lg:row-start-3 lg:block">
      <p className="mt-4">{query.data.is_consumable ? `${query.data.quantity} in stock` : 'Reusable · no stock quantity'}</p>
      {query.data.description && <p className="mt-4 whitespace-pre-wrap break-words">{query.data.description}</p>}
      {me.id === query.data.owner_id && <>
        <Link to={`/caches/${cacheId}/items/${itemId}/edit`} className="cc-pill mt-6">Edit item</Link>
        {!deletionDisabled && <DeleteItem item={query.data} />}
        <PhotoUpload item={query.data} />
      </>}
      {requestsDisabled ? <p role="status" className="mt-6">Requests are being moved, back soon</p> : <ItemRequests item={query.data} />}
      </div>
    </div>}
  </main>
}

function ItemForm({ cacheId, item }: { cacheId: string; item?: Item }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [title, setTitle] = useState(item?.title ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [consumable, setConsumable] = useState(item?.is_consumable ?? false)
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 0))
  const save = useMutation({
    mutationFn: () => apiFetch<Item>(`/api/caches/${cacheId}/items${item ? `/${item.id}` : ''}`, {
      method: item ? 'PATCH' : 'POST',
      body: { title, description: description.trim() || null, quantity: consumable ? Number(quantity) : null, ...(!item ? { is_consumable: consumable } : {}) },
    }),
    onSuccess: async saved => {
      queryClient.setQueryData(['item', cacheId, saved.id], saved)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['items'] }), queryClient.invalidateQueries({ queryKey: ['item'] })])
      navigate(`/caches/${cacheId}/items/${saved.id}`)
    },
  })
  function onSubmit(event: FormEvent) { event.preventDefault(); save.mutate() }
  return <form className="mt-6 space-y-4 lg:max-w-[640px]" onSubmit={onSubmit}>
    <div><label htmlFor="item-title" className="block text-sm font-medium">Title</label>
      <input id="item-title" type="text" required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
    </div>
    <div><label htmlFor="item-description" className="block text-sm font-medium">Description (optional)</label>
      <textarea id="item-description" rows={4} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
    </div>
    {item ? <p className="text-sm text-slate-600">{consumable ? 'Consumable' : 'Reusable'} · Item type cannot be changed.</p> : <label className="flex items-start gap-2">
      <input type="checkbox" checked={consumable} onChange={event => setConsumable(event.target.checked)} className="mt-1" />
      <span>Consumable <span className="block text-sm text-slate-600">Things that get used up, like sugar or seeds.</span></span>
    </label>}
    {consumable && <div><label htmlFor="item-quantity" className="block text-sm font-medium">Stock quantity</label>
      <input id="item-quantity" type="number" inputMode="numeric" required min={0} max={9999} step={1} value={quantity} onChange={event => setQuantity(event.target.value)} aria-describedby="quantity-help" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
      <p id="quantity-help" className="mt-1 text-sm text-slate-600">0–9999. Zero stock is fine; pending requests must stay covered.</p>
    </div>}
    {save.isError && <p role="alert" className="text-red-700">{errorMessage(save.error)}</p>}
    <div className="flex items-center gap-4">
      <button type="submit" disabled={save.isPending || !title.trim()} className="cc-pill">{save.isPending ? 'Saving…' : item ? 'Save item' : 'Add item'}</button>
      <Link to={item ? `/caches/${cacheId}/items/${item.id}` : `/caches/${cacheId}`} className="underline">Cancel</Link>
    </div>
  </form>
}

export function ItemEditorPage({ editing = false }: { editing?: boolean }) {
  const { cacheId = '', itemId = '' } = useParams()
  const { me } = useAuth()
  const cache = useQuery({ queryKey: ['cache', cacheId], queryFn: () => apiFetch<CacheDetail>(`/api/caches/${cacheId}`), enabled: !!me?.display_name })
  const item = useQuery({ queryKey: ['item', cacheId, itemId], queryFn: () => apiFetch<Item>(`/api/caches/${cacheId}/items/${itemId}`), enabled: editing && !!me?.display_name })
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  if (editing && item.isSuccess && item.data.owner_id !== me.id) return <Navigate to={`/caches/${cacheId}/items/${itemId}`} replace />
  const error = cache.error ?? (editing ? item.error : null)
  const pending = cache.isPending || (editing && item.isPending)
  return <main className="cc-page lg:max-w-[1120px] lg:p-8">
    <Link to={`/caches/${cacheId}`} className="text-sm underline">‹ Back to cache</Link>
    <h1 className="mt-4 text-2xl font-semibold tracking-tight">{editing ? 'Edit item' : 'Add an item'}</h1>
    {pending && <p role="status" className="mt-4">Loading…</p>}
    {error && <div className="mt-4"><p role="alert" className="text-red-700">{errorMessage(error)}</p><button className="mt-2 underline" onClick={() => { void cache.refetch(); if (editing) void item.refetch() }}>Try again</button></div>}
    {!pending && !error && <ItemForm key={editing ? itemId : 'new'} cacheId={cacheId} item={editing ? item.data : undefined} />}
  </main>
}
