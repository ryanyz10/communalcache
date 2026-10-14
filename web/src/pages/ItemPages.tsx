import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import type { CacheDetail } from '../lib/caches'
import type { Item } from '../lib/items'
import { OnboardingPage } from './OnboardingPage'
import { ItemPhoto, PhotoUpload } from './ItemPhoto'
import { ItemRequests } from './RequestsPage'

export function ItemList({ cacheId }: { cacheId: string }) {
  const query = useQuery({ queryKey: ['items', cacheId], queryFn: () => apiFetch<Item[]>(`/api/caches/${cacheId}/items`) })
  return <section className="mt-8" aria-labelledby="items-heading">
    <div className="flex items-center justify-between gap-3">
      <h2 id="items-heading" className="text-xl font-semibold">Shared things</h2>
      <Link to={`/caches/${cacheId}/items/new`} className="rounded-md bg-slate-900 px-4 py-2 text-white">Add item</Link>
    </div>
    {query.isPending && <p role="status" className="mt-4">Loading items…</p>}
    {query.isError && <div className="mt-4"><p role="alert" className="text-red-700">{errorMessage(query.error)}</p><button className="mt-2 underline" onClick={() => void query.refetch()}>Try items again</button></div>}
    {query.isSuccess && (query.data.length ? <ul className="mt-4 space-y-3">{query.data.map(item => <li key={item.id}>
      <Link to={`/caches/${cacheId}/items/${item.id}`} className="block rounded-lg border border-slate-200 bg-white p-4">
        <ItemPhoto key={item.photo_version} item={item} thumbnail />
        <h3 className="break-words font-semibold">{item.title}</h3>
        <p className="mt-1 text-sm text-slate-600">{item.owner_name ?? 'Member'} · {item.is_consumable ? `${item.quantity} in stock` : 'Reusable'}</p>
      </Link>
    </li>)}</ul> : <p className="mt-4 text-slate-600">Nothing shared yet. Add the first item for your neighbors.</p>)}
  </section>
}

export function ItemPage() {
  const { cacheId = '', itemId = '' } = useParams()
  const { me } = useAuth()
  const query = useQuery({ queryKey: ['item', cacheId, itemId], queryFn: () => apiFetch<Item>(`/api/caches/${cacheId}/items/${itemId}`), enabled: !!me?.display_name })
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  return <main className="mx-auto max-w-md px-4 py-8">
    <Link to={`/caches/${cacheId}`} className="underline">Back to cache</Link>
    {query.isPending && <p role="status" className="mt-4">Loading item…</p>}
    {query.isError && <div className="mt-4"><p role="alert" className="text-red-700">{errorMessage(query.error)}</p><button className="mt-2 underline" onClick={() => void query.refetch()}>Try again</button></div>}
    {query.isSuccess && <>
      <h1 className="mt-4 break-words text-2xl font-semibold tracking-tight">{query.data.title}</h1>
      <p className="mt-2 text-slate-600">Shared by {query.data.owner_name ?? 'Member'}</p>
      <ItemPhoto key={query.data.photo_version} item={query.data} />
      <p className="mt-4">{query.data.is_consumable ? `${query.data.quantity} in stock` : 'Reusable · no stock quantity'}</p>
      {query.data.description && <p className="mt-4 whitespace-pre-wrap break-words">{query.data.description}</p>}
      {me.id === query.data.owner_id && <>
        <Link to={`/caches/${cacheId}/items/${itemId}/edit`} className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-white">Edit item</Link>
        <PhotoUpload item={query.data} />
      </>}
      <ItemRequests item={query.data} />
    </>}
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
      await queryClient.invalidateQueries({ queryKey: ['items', cacheId] })
      navigate(`/caches/${cacheId}/items/${saved.id}`)
    },
  })
  function onSubmit(event: FormEvent) { event.preventDefault(); save.mutate() }
  return <form className="mt-6 space-y-4" onSubmit={onSubmit}>
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
      <button type="submit" disabled={save.isPending || !title.trim()} className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60">{save.isPending ? 'Saving…' : item ? 'Save item' : 'Add item'}</button>
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
  return <main className="mx-auto max-w-md px-4 py-8">
    <Link to={`/caches/${cacheId}`} className="underline">Back to cache</Link>
    <h1 className="mt-4 text-2xl font-semibold tracking-tight">{editing ? 'Edit item' : 'Add an item'}</h1>
    {pending && <p role="status" className="mt-4">Loading…</p>}
    {error && <div className="mt-4"><p role="alert" className="text-red-700">{errorMessage(error)}</p><button className="mt-2 underline" onClick={() => { void cache.refetch(); if (editing) void item.refetch() }}>Try again</button></div>}
    {!pending && !error && <ItemForm key={editing ? itemId : 'new'} cacheId={cacheId} item={editing ? item.data : undefined} />}
  </main>
}
