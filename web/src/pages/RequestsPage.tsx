import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import type { Item } from '../lib/items'
import { invalidateRequestViews, useRequests, type ItemRequest } from '../lib/requests'
import { RequestStatus } from '../components/RequestStatus'
import { OnboardingPage } from './OnboardingPage'

function RequestDecision({ request }: { request: ItemRequest }) {
  const client = useQueryClient()
  const [reason, setReason] = useState('')
  const decision = useMutation({
    mutationFn: (action: 'approve' | 'reject') => apiFetch<ItemRequest>(`/api/caches/${request.cache_id}/requests/${request.id}/${action}`, { body: action === 'reject' ? { reason } : {} }),
    onSettled: () => invalidateRequestViews(client, request.cache_id, request.item_id),
  })
  function reject(event: FormEvent) { event.preventDefault(); if (reason.trim()) decision.mutate('reject') }
  return <div className="mt-3">
    <button type="button" disabled={decision.isPending} onClick={() => decision.mutate('approve')} className="cc-pill">Approve request from {request.requester_name ?? 'Member'}</button>
    <form className="mt-3 space-y-2" onSubmit={reject}>
      <label htmlFor={`reason-${request.id}`} className="block text-sm font-medium">Reason for rejection</label>
      <input id={`reason-${request.id}`} type="text" required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" />
      <button type="submit" disabled={decision.isPending || !reason.trim()} className="cc-outline">Reject request from {request.requester_name ?? 'Member'}</button>
    </form>
    {decision.isPending && <p role="status" className="mt-2">Saving decision…</p>}
    {decision.isError && <p role="alert" className="mt-2 text-red-700">{errorMessage(decision.error)}</p>}
  </div>
}

export function RequestCard({ request, callerId }: { request: ItemRequest; callerId: string }) {
  return <li className="border-t border-slate-100 p-4 first:border-t-0">
    <Link to={`/caches/${request.cache_id}/items/${request.item_id}`} className="break-words font-semibold underline">{request.item_title}</Link>
    <p className="mt-1 text-sm text-slate-600">{request.cache_name} · {new Date(request.created_at).toLocaleString()}</p>
    <p className="mt-2">{request.requester_name ?? 'Member'} asked {request.owner_name ?? 'Member'}{request.quantity === null ? ' to use this' : ` for ${request.quantity}`}.</p>
    <div className="mt-2"><RequestStatus status={request.status} /></div>
    {request.decision_reason && <p className="mt-2 break-words">Reason: {request.decision_reason}</p>}
    {request.status === 'pending' && request.owner_id === callerId && <RequestDecision request={request} />}
  </li>
}

export function ItemRequests({ item }: { item: Item }) {
  const { me } = useAuth()
  const client = useQueryClient()
  const [quantity, setQuantity] = useState('1')
  const query = useQuery({ queryKey: ['item-requests', item.cache_id, item.id], queryFn: () => apiFetch<ItemRequest[]>(`/api/caches/${item.cache_id}/items/${item.id}/requests`), enabled: !!me?.display_name })
  const ask = useMutation({
    mutationFn: () => apiFetch<ItemRequest>(`/api/caches/${item.cache_id}/items/${item.id}/requests`, { body: { quantity: item.is_consumable ? Number(quantity) : null } }),
    onSettled: () => invalidateRequestViews(client, item.cache_id, item.id),
  })
  function submit(event: FormEvent) { event.preventDefault(); ask.mutate() }
  const pending = query.data?.filter(row => row.status === 'pending') ?? []
  const available = item.quantity === null ? null : item.quantity - pending.reduce((sum, row) => sum + (row.quantity ?? 0), 0)
  return <section className="mt-8 lg:rounded-[14px] lg:border lg:border-slate-200 lg:bg-white lg:p-4" aria-labelledby="requests-heading">
    <div className="flex items-center justify-between gap-3"><h2 id="requests-heading" className="text-xl font-semibold">Requests</h2></div>
    <p className="mt-2 text-sm text-slate-600">Pending requests are visible to cache members. Decisions are visible only to the requester and item owner.</p>
    {query.isPending && <p role="status" className="mt-3">Loading requests…</p>}
    {query.isError && <div className="mt-3"><p role="alert" className="text-red-700">{errorMessage(query.error)}</p><button className="mt-2 text-sm underline" disabled={query.isFetching} onClick={() => void query.refetch()}>Try requests again</button></div>}
    {query.isSuccess && <>
      {available !== null && <p className="mt-3">Available now: {available}</p>}
      {me && me.id !== item.owner_id && <form className="mt-4 space-y-3" onSubmit={submit}>
        {item.is_consumable && <div><label htmlFor="request-quantity" className="block text-sm font-medium">Quantity to request</label>
          <input id="request-quantity" type="number" inputMode="numeric" min={1} max={9999} step={1} required value={quantity} onChange={event => setQuantity(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </div>}
        {available !== null && available <= 0 && <p className="text-slate-600">No stock available now.</p>}
        <button type="submit" disabled={ask.isPending || (available !== null && available <= 0)} className="cc-pill">{ask.isPending ? 'Sending request…' : 'Ask to use'}</button>
        {ask.isError && <p role="alert" className="text-red-700">{errorMessage(ask.error)}</p>}
        {ask.isSuccess && <p role="status" className="text-emerald-700">Request sent. Arrange the handoff in person if approved.</p>}
      </form>}
      <ul className="cc-list mt-4 lg:border-0">{query.data.map(request => <RequestCard key={request.id} request={request} callerId={me?.id ?? ''} />)}</ul>
      {!query.data.length && <p className="mt-4 text-slate-600">No visible requests for this item yet.</p>}
    </>}
    <Link to="/requests" className="mt-4 inline-block underline">Your incoming and outgoing requests</Link>
  </section>
}

export function RequestsPage() {
  const { me } = useAuth()
  const query = useRequests(!!me?.display_name)
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  const requests = query.data?.pages.flatMap(page => page.requests) ?? []
  const unavailable = query.data?.pages.flatMap(page => page.unavailable_cache_ids) ?? []
  return <main className="cc-page lg:max-w-[1120px] lg:p-8">
    <h1 className="text-2xl font-semibold tracking-tight lg:text-[28px] lg:font-bold">Requests</h1>
    {query.isPending && <p role="status" className="mt-4">Loading requests…</p>}
    {query.isError && <div className="mt-4"><p role="alert" className="text-red-700">{errorMessage(query.error)} Some requests may be unavailable.</p><button className="mt-2 text-sm underline" disabled={query.isFetching} onClick={() => void query.refetch()}>Try requests again</button></div>}
    {!!unavailable.length && <div className="mt-4"><p role="alert" className="text-amber-800">Requests from {unavailable.length} cache(s) could not be loaded. These lists are incomplete.</p><button className="mt-2 text-sm underline" disabled={query.isFetching} onClick={() => void query.refetch()}>Try unavailable caches again</button></div>}
    {query.data && <>
      <div className="contents lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      {([
        { heading: 'Needs your answer', rows: requests.filter(request => request.owner_id === me.id && request.status === 'pending'), empty: 'No requests need your answer in the loaded caches.' },
        { heading: 'Your requests', rows: requests.filter(request => request.requester_id === me.id), empty: 'None of your requests are visible in the loaded caches.' },
      ]).map(({ heading, rows, empty }) => <section key={heading} className="mt-6 lg:mt-6 lg:min-w-0 lg:rounded-[14px] lg:border lg:border-slate-200 lg:bg-white lg:p-4" aria-label={heading}>
        <h2 className="cc-section-title lg:mb-0 lg:ml-0 lg:text-[17px] lg:tracking-normal lg:text-slate-900 lg:normal-case">{heading}</h2>
        <ul className="cc-list lg:mt-4 lg:border-0">{rows.map(request => <RequestCard key={request.id} request={request} callerId={me.id} />)}</ul>
        {!rows.length && <p className="mt-3 text-slate-600">{empty}{unavailable.length || query.isError || query.hasNextPage ? ' This list may be incomplete.' : ''}</p>}
      </section>)}
      </div>
      {query.hasNextPage && <button className="mt-6 rounded-md border border-slate-300 px-4 py-2 disabled:opacity-60" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading more…' : 'Load more caches'}</button>}
      <p className="mt-6 text-sm text-slate-600">Cache discovery can lag after joining. Open the item directly if a request has not appeared here yet.</p>
    </>}
  </main>
}
