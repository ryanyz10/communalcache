import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import type { CacheDetail } from '../lib/caches'
import type { Item } from '../lib/items'
import { invalidateRequestViews } from '../lib/requests'
import { OnboardingPage } from './OnboardingPage'
import { ItemPhoto, PhotoUpload } from './ItemPhoto'
import { ItemRequests } from './RequestsPage'
import { WideBreadcrumbs } from '../components/WideBreadcrumbs'
import { Avatar } from '../components/Avatar'
import { ItemForm } from './ItemForm'
import { ShownIn } from './ShownIn'

export function ItemList({ cacheId, onAdd }: { cacheId: string; onAdd?: () => void }) {
  const query = useQuery({ queryKey: ['items', cacheId], queryFn: () => apiFetch<Item[]>(`/api/caches/${cacheId}/items`) })
  return <section className="mt-6" aria-labelledby="items-heading">
    <div className="flex items-center justify-between gap-3 lg:hidden">
      <h2 id="items-heading" className="text-xl font-semibold">Shared things</h2>
      <button type="button" onClick={onAdd} className="cc-pill">+ Add item</button>
    </div>
    {query.isPending && <p role="status" className="mt-4">Loading items…</p>}
    {query.isError && <div className="mt-4"><p role="alert" className="text-red-700">{errorMessage(query.error)}</p><button className="mt-2 underline" onClick={() => void query.refetch()}>Try items again</button></div>}
    {query.isSuccess && (query.data.length ? <ul className="cc-list mt-3 lg:mt-0 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] lg:gap-4 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent">{query.data.map(item => <li key={item.id} className="border-t border-slate-100 first:border-t-0 lg:border-0">
      <Link to={`/caches/${cacheId}/items/${item.id}`} className="flex items-center gap-3 px-4 py-3.5 lg:block lg:h-full lg:overflow-hidden lg:rounded-[14px] lg:border lg:border-slate-200 lg:bg-white lg:p-0">
        <ItemPhoto key={item.photo_version} item={item} thumbnail />
        <div className="min-w-0 flex-1 lg:px-3.5 lg:py-3"><h3 className="break-words font-semibold">{item.title}</h3>
        <p className="flex items-center gap-2 text-sm text-slate-600"><Avatar userId={item.owner_id} name={item.owner_name ?? 'Member'} photoVersion={item.owner_photo_version} size={24} /><span>{item.owner_name ?? 'Member'} · {item.is_consumable ? `${item.quantity} in stock` : 'Reusable'}</span></p>{item.available === false && <p className="mt-1 text-sm text-slate-600">Lent out{item.unavailable_note ? ` · ${item.unavailable_note}` : ''}</p>}</div><span aria-hidden="true" className="text-xl leading-none text-slate-500 lg:hidden">›</span>
      </Link>
    </li>)}<li className="hidden lg:block"><button type="button" onClick={onAdd} className="lg:flex lg:h-full lg:min-h-[120px] lg:w-full lg:items-center lg:justify-center lg:rounded-[14px] lg:border-2 lg:border-dashed lg:border-slate-300 lg:font-semibold lg:text-slate-600">+ Add item</button></li></ul> : <p className="mt-4 text-slate-600">Nothing shared yet. Add the first item for your neighbors.</p>)}
    {query.isSuccess && !query.data.length && <button type="button" onClick={onAdd} className="hidden lg:mt-4 lg:flex lg:min-h-[120px] lg:w-full lg:items-center lg:justify-center lg:rounded-[14px] lg:border-2 lg:border-dashed lg:border-slate-300 lg:font-semibold lg:text-slate-600">+ Add item</button>}
  </section>
}

function DeleteItem({ item }: { item: Item }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const client = useQueryClient()
  const navigate = useNavigate()
  const remove = useMutation({
    mutationFn: () => apiFetch<void>(`/api/me/items/${item.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      dialog.current?.close()
      navigate('/items')
      client.removeQueries({ queryKey: ['item'] })
      client.removeQueries({ queryKey: ['library-item'] })
      client.removeQueries({ queryKey: ['item-requests'] })
      await invalidateRequestViews(client)
    },
  })
  return <>
    <button type="button" className="ml-3 mt-6 rounded-full border border-red-300 px-3.5 py-1.5 text-sm font-medium text-red-800" onClick={() => { remove.reset(); dialog.current?.showModal() }}>Delete item</button>
    <dialog ref={dialog} onCancel={event => { if (remove.isPending) event.preventDefault() }} className="w-[calc(100%-2rem)] max-w-md rounded-lg bg-white p-6 text-slate-900" aria-labelledby="delete-item-heading">
      <h2 id="delete-item-heading" className="text-xl font-semibold">Delete {item.title} everywhere?</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5"><li>This permanently removes the item from your library and every cache.</li><li>Its request history is erased. Neighbors with pending requests will be notified.</li><li>Its private photos are queued for cleanup.</li></ul>
      {remove.isError && <p role="alert" className="mt-3 text-red-700">{errorMessage(remove.error)}</p>}
      <div className="mt-6 flex gap-3">
        <button type="button" autoFocus disabled={remove.isPending} onClick={() => dialog.current?.close()} className="rounded-md border border-slate-300 px-4 py-2">Cancel</button>
        <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()} className="rounded-md bg-red-700 px-4 py-2 text-white disabled:opacity-60">{remove.isPending ? 'Deleting…' : 'Confirm deletion'}</button>
      </div>
    </dialog>
  </>
}

function ItemAvailability({ item }: { item: Item }) {
  const client = useQueryClient()
  const [lentOut, setLentOut] = useState(item.available === false)
  const [note, setNote] = useState(item.unavailable_note ?? '')
  const noteTooLong = [...note.trim()].length > 200
  const save = useMutation({
    mutationFn: () => apiFetch(`/api/me/items/${item.id}`, { method: 'PATCH', body: { available: !lentOut, unavailable_note: note.trim() || null } }),
    onSettled: () => invalidateRequestViews(client),
  })
  function submit(event: FormEvent) { event.preventDefault(); if (!noteTooLong) save.mutate() }
  return <form className="mt-6 space-y-3" onSubmit={submit} aria-label="Item availability">
    <label className="flex items-center gap-3"><input type="checkbox" checked={lentOut} disabled={save.isPending} onChange={event => setLentOut(event.target.checked)} className="cc-switch" />Lent out</label>
    <div><label htmlFor="unavailable-note" className="block text-sm font-medium">Lent out note (optional)</label><input id="unavailable-note" value={note} disabled={save.isPending} onChange={event => setNote(event.target.value)} className="cc-input" /><p className="mt-1 text-sm text-slate-600">Up to 200 characters. This blocks new requests, not existing pending requests.</p></div>
    {noteTooLong && <p role="alert" className="text-red-700">Keep the note within 200 characters.</p>}
    {save.isError && <p role="alert" className="text-red-700">{errorMessage(save.error)}</p>}
    {save.isSuccess && <p role="status" className="text-emerald-700">Availability saved.</p>}
    <button type="submit" disabled={save.isPending || noteTooLong} className="cc-outline">{save.isPending ? 'Saving…' : 'Save availability'}</button>
  </form>
}

export function ItemPage() {
  const { cacheId, itemId = '' } = useParams()
  const { me } = useAuth()
  const query = useQuery({ queryKey: cacheId ? ['item', cacheId, itemId] : ['library-item', me?.id, itemId], queryFn: () => apiFetch<Item>(`${cacheId ? `/api/caches/${cacheId}/items` : '/api/me/items'}/${itemId}`), enabled: !!me?.display_name })
  const back = cacheId ? `/caches/${cacheId}` : '/items'
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  return <main className="cc-page lg:max-w-[1200px] lg:p-8">
    <WideBreadcrumbs><Link to="/">Home</Link><span aria-hidden="true">›</span><Link to={back}>{cacheId ? 'Cache' : 'Your items'}</Link>{query.data && <><span aria-hidden="true">›</span><span>{query.data.title}</span></>}</WideBreadcrumbs>
    <Link to={back} className="text-sm underline lg:hidden">‹ {cacheId ? 'Back to cache' : 'Your items'}</Link>
    {query.isPending && <p role="status" className="mt-4">Loading item…</p>}
    {query.isError && <div className="mt-4"><p role="alert" className="text-red-700">{errorMessage(query.error)}</p><button className="mt-2 underline" onClick={() => void query.refetch()}>Try again</button></div>}
    {query.isSuccess && <div className="contents lg:mt-4 lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr] lg:items-start lg:gap-x-10">
      <h1 className="mt-4 break-words text-2xl font-semibold tracking-tight lg:col-start-2 lg:row-start-1 lg:mt-0 lg:text-[28px] lg:font-bold">{query.data.title}</h1>
      <p className="mt-2 flex items-center gap-2 text-slate-600 lg:col-start-2 lg:row-start-2"><Avatar userId={query.data.owner_id} name={query.data.owner_name ?? 'Member'} photoVersion={query.data.owner_photo_version} size={28} /><span>Shared by {query.data.owner_name ?? 'Member'}</span></p>
      <div className="contents lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:block"><ItemPhoto key={query.data.photo_version} item={query.data} /></div>
      <div className="contents lg:col-start-2 lg:row-start-3 lg:block">
      <p className="mt-4">{query.data.is_consumable ? `${query.data.quantity} in stock` : 'Reusable · no stock quantity'}</p>
      {query.data.description && <p className="mt-4 whitespace-pre-wrap break-words">{query.data.description}</p>}
      {me.id === query.data.owner_id && <>
        <Link to={cacheId ? `/caches/${cacheId}/items/${itemId}/edit` : `/items/${itemId}/edit`} className="cc-pill mt-6">Edit item</Link>
        <DeleteItem item={query.data} />
        <ItemAvailability key={`${query.data.id}:${query.data.available}:${query.data.unavailable_note ?? ''}`} item={query.data} />
        <ShownIn item={query.data} />
        <PhotoUpload item={query.data} />
        {!cacheId && <Link to="/requests" className="cc-outline mt-6">View asks in Requests</Link>}
      </>}
      {cacheId && <ItemRequests item={query.data} />}
      </div>
    </div>}
  </main>
}

export function ItemEditorPage({ editing = false }: { editing?: boolean }) {
  const { cacheId, itemId = '' } = useParams()
  const { me } = useAuth()
  const navigate = useNavigate()
  const cache = useQuery({ queryKey: ['cache', cacheId], queryFn: () => apiFetch<CacheDetail>(`/api/caches/${cacheId}`), enabled: !!cacheId && !!me?.display_name })
  const item = useQuery({ queryKey: cacheId ? ['item',cacheId,itemId] : ['library-item',me?.id,itemId], queryFn: () => apiFetch<Item>(`${cacheId ? `/api/caches/${cacheId}/items` : '/api/me/items'}/${itemId}`), enabled: editing && !!me?.display_name })
  const back = cacheId ? `/caches/${cacheId}` : '/items'
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  if (editing && item.isSuccess && item.data.owner_id !== me.id) return <Navigate to={back} replace />
  const error = (cacheId ? cache.error : null) ?? (editing ? item.error : null)
  const pending = (!!cacheId && cache.isPending) || (editing && item.isPending)
  return <main className="cc-page lg:max-w-[1120px] lg:p-8">
    <Link to={back} className="text-sm underline">‹ {cacheId ? 'Back to cache' : 'Your items'}</Link>
    <h1 className="mt-4 text-2xl font-semibold tracking-tight">{editing ? 'Edit item' : cacheId ? 'Add an item' : 'New item'}</h1>
    {pending && <p role="status" className="mt-4">Loading…</p>}
    {error && <div className="mt-4"><p role="alert" className="text-red-700">{errorMessage(error)}</p><button className="mt-2 underline" onClick={() => { if (cacheId) void cache.refetch(); if (editing) void item.refetch() }}>Try again</button></div>}
    {!pending && !error && <ItemForm key={editing ? itemId : `new:${cacheId ?? 'library'}`} cacheId={cacheId ?? null} item={editing ? item.data : undefined} onSaved={saved => navigate(cacheId ? `/caches/${cacheId}/items/${saved.id}` : `/items/${saved.id}`)} onCancel={() => navigate(editing ? cacheId ? `/caches/${cacheId}/items/${itemId}` : `/items/${itemId}` : back)} />}
  </main>
}
