import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import type { Item } from '../lib/items'
import { invalidateRequestViews, useRequests, type ItemRequest } from '../lib/requests'
import { RequestStatus } from '../components/RequestStatus'
import { Avatar } from '../components/Avatar'
import { OnboardingPage } from './OnboardingPage'
import { ContactLink } from '../components/ContactLink'
import { useOwnContact, type Contact } from '../lib/contacts'

function RequestDecision({ request }: { request: ItemRequest }) {
  const client = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  const [message, setMessage] = useState('')
  const messageTooLong = [...message.trim()].length > 500
  const [reason, setReason] = useState('')
  const [lentOut, setLentOut] = useState(false)
  const [note, setNote] = useState('')
  const noteTooLong = [...note.trim()].length > 200
  const decision = useMutation({
    mutationFn: (action: 'approve' | 'reject') => apiFetch<ItemRequest>(`/api/me/requests/${request.id}/${action}`, { body: action === 'reject' ? { reason } : { approval_message: message, mark_lent_out: lentOut, ...(lentOut ? { unavailable_note: note.trim() || null } : {}) } }),
    onSuccess: () => dialog.current?.close(),
    onSettled: () => invalidateRequestViews(client),
  })
  function reject(event: FormEvent) { event.preventDefault(); if (reason.trim()) decision.mutate('reject') }
  return <div className="mt-3">
    <button type="button" className="cc-pill" aria-haspopup="dialog" onClick={()=>{setMessage('');decision.reset();dialog.current?.showModal()}}>Approve request from {request.requester_name ?? 'Member'}</button>
    <dialog ref={dialog} className="cc-sheet lg:w-[440px] lg:rounded-2xl lg:p-6" aria-labelledby={`approve-heading-${request.id}`} onCancel={event=>{if(decision.isPending)event.preventDefault()}}>
    <h2 id={`approve-heading-${request.id}`} className="text-xl font-semibold">Approve for {request.requester_name ?? 'Member'}?</h2>
    <label htmlFor={`approval-message-${request.id}`} className="mt-4 block text-sm font-medium">Message (optional)</label>
    <textarea id={`approval-message-${request.id}`} value={message} placeholder={`Add a note for ${request.requester_name ?? 'Member'}`} onChange={event=>setMessage(event.target.value)} disabled={decision.isPending} className="cc-input mb-3" />
    <p className="mb-3 text-sm text-slate-600">Up to 500 characters. Only the two of you see this message. Contact details are shared only while you're both active in this cache.</p>
    {messageTooLong && <p role="alert" className="mb-3 text-red-700">Keep the message within 500 characters.</p>}
    {request.quantity === null && <label className="mb-3 flex items-center gap-2"><input type="checkbox" checked={lentOut} disabled={decision.isPending} onChange={event => setLentOut(event.target.checked)} />Mark as lent out</label>}
    {lentOut && <div className="mb-3"><label htmlFor={`approval-note-${request.id}`} className="block text-sm font-medium">Lent out note (optional)</label><input id={`approval-note-${request.id}`} value={note} disabled={decision.isPending} onChange={event => setNote(event.target.value)} className="cc-input" />{noteTooLong && <p role="alert" className="mt-1 text-sm text-red-700">Keep the note within 200 characters.</p>}</div>}
    <div className="flex gap-2"><button type="button" disabled={decision.isPending || messageTooLong || (lentOut && noteTooLong)} onClick={() => decision.mutate('approve')} className="cc-pill">Approve</button><button type="button" disabled={decision.isPending} className="cc-outline" onClick={()=>dialog.current?.close()}>Cancel</button></div>
    {decision.isError && <p role="alert" className="mt-2 text-red-700">{errorMessage(decision.error)}</p>}
    </dialog>
    <form className="mt-3 space-y-2" onSubmit={reject}>
      <label htmlFor={`reason-${request.id}`} className="block text-sm font-medium">Reason for rejection</label>
      <input id={`reason-${request.id}`} type="text" required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" />
      <button type="submit" disabled={decision.isPending || !reason.trim()} className="cc-outline">Reject request from {request.requester_name ?? 'Member'}</button>
    </form>
    {decision.isPending && <p role="status" className="mt-2">Saving decision…</p>}
    {decision.isError && <p role="alert" className="mt-2 text-red-700">{errorMessage(decision.error)}</p>}
  </div>
}

export function ApprovedContact({ request, callerId }: { request: ItemRequest; callerId: string }) {
  const query = useQuery({ queryKey:['request-contact',callerId,request.id], queryFn:()=>apiFetch<{contact:Contact|null}>(`/api/me/requests/${request.id}/contact`), retry:false, gcTime:0 })
  const name = (callerId===request.owner_id ? request.requester_name : request.owner_name) ?? 'Member'
  if (query.isPending) return <p role="status" className="mt-3">Loading contact…</p>
  if (query.isError) return <div className="mt-3"><p className="text-sm text-slate-600">Contact is unavailable. Both people must still be active in this request's cache.</p><button className="mt-2 underline" onClick={()=>void query.refetch()}>Try contact again</button></div>
  return query.data.contact ? <ContactLink contact={query.data.contact} name={name} /> : <p className="mt-3 text-sm text-slate-600">{name} hasn't added a way to reach them yet.</p>
}

export function RequestCard({ request, callerId }: { request: ItemRequest; callerId: string }) {
  return <li className="border-t border-slate-100 p-4 first:border-t-0">
    <Link to={`/caches/${request.cache_id}/items/${request.item_id}`} className="break-words font-semibold underline">{request.item_title}</Link>
    <p className="mt-1 text-sm text-slate-600">{request.cache_name} · {new Date(request.created_at).toLocaleString()}</p>
    <div className="mt-2 flex items-center gap-2"><Avatar userId={request.requester_id} name={request.requester_name ?? 'Member'} photoVersion={request.requester_photo_version} coat={request.requester_cat_coat} size={24} /><Avatar userId={request.owner_id} name={request.owner_name ?? 'Member'} photoVersion={request.owner_photo_version} coat={request.owner_cat_coat} size={24} /><p>{request.requester_name ?? 'Member'} asked {request.owner_name ?? 'Member'}{request.quantity === null ? ' to use this' : ` for ${request.quantity}`}.</p></div>
    <div className="mt-2"><RequestStatus status={request.status} /></div>
    {request.status === 'approved' && (callerId === request.owner_id || callerId === request.requester_id) && <>
      {request.approval_message && <p className="mt-3 whitespace-pre-wrap break-words">{request.approval_message}</p>}
      <ApprovedContact request={request} callerId={callerId} />
    </>}
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
    onSettled: () => invalidateRequestViews(client),
  })
  function submit(event: FormEvent) { event.preventDefault(); ask.mutate() }
  const available = item.is_consumable ? item.available_quantity : null
  return <section className="mt-8 lg:rounded-[14px] lg:border lg:border-slate-200 lg:bg-white lg:p-4" aria-labelledby="requests-heading">
    <div className="flex items-center justify-between gap-3"><h2 id="requests-heading" className="text-xl font-semibold">Requests</h2></div>
    <p className="mt-2 text-sm text-slate-600">Pending requests are visible to cache members. Decisions are visible only to the requester and item owner.</p>
    {query.isPending && <p role="status" className="mt-3">Loading requests…</p>}
    {query.isError && <div className="mt-3"><p role="alert" className="text-red-700">{errorMessage(query.error)}</p><button className="mt-2 text-sm underline" disabled={query.isFetching} onClick={() => void query.refetch()}>Try requests again</button></div>}
    {query.isSuccess && <>
      {available !== null && available !== undefined && <p className="mt-3">Available now: {available}</p>}
      {item.available === false && <p className="mt-3 text-slate-600">Lent out{item.unavailable_note ? ` · ${item.unavailable_note}` : ''}. Existing requests can still be decided.</p>}
      {me && me.id !== item.owner_id && <form className="mt-4 space-y-3" onSubmit={submit}>
        {item.is_consumable && <div><label htmlFor="request-quantity" className="block text-sm font-medium">Quantity to request</label>
          <input id="request-quantity" type="number" inputMode="numeric" min={1} max={9999} step={1} required value={quantity} onChange={event => setQuantity(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </div>}
        {available !== null && available !== undefined && available <= 0 && <p className="text-slate-600">No stock available now.</p>}
        {item.is_consumable && available === undefined && <p className="text-slate-600">Refresh the item to see current availability.</p>}
        <button type="submit" disabled={ask.isPending || item.available === false || (item.is_consumable && (available === undefined || available === null || available <= 0))} className="cc-pill">{ask.isPending ? 'Sending request…' : 'Ask to use'}</button>
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
  const ownContact = useOwnContact(me?.id ?? '')
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  const requests = query.data?.pages.flatMap(page => page.requests) ?? []
  const unavailable = query.data?.pages.flatMap(page => page.unavailable_cache_ids) ?? []
  return <main className="cc-page">
    <h1 className="text-2xl font-semibold tracking-tight lg:text-[28px] lg:font-bold">Requests</h1>
    {ownContact.isSuccess && !ownContact.data.contact && <aside className="mt-4 rounded-lg border border-slate-200 p-4"><h2 className="font-semibold">Add how to reach you</h2><p className="mt-1 text-sm text-slate-600">The other person sees it after approval, while you're both active in that cache.</p><Link to="/account" className="mt-2 inline-block underline">Add contact</Link></aside>}
    {query.isPending && <p role="status" className="mt-4">Loading requests…</p>}
    {query.isError && <div className="mt-4"><p role="alert" className="text-red-700">{errorMessage(query.error)} Some requests may be unavailable.</p><button className="mt-2 text-sm underline" disabled={query.isFetching} onClick={() => void query.refetch()}>Try requests again</button></div>}
    {!!unavailable.length && <div className="mt-4"><p role="alert" className="text-amber-800">Requests from {unavailable.length} cache(s) could not be loaded. These lists are incomplete.</p><button className="mt-2 text-sm underline" disabled={query.isFetching} onClick={() => void query.refetch()}>Try unavailable caches again</button></div>}
    {query.data && <>
      <div className="cc-requests-layout contents lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      {([
        { heading: 'Needs your answer', rows: requests.filter(request => request.owner_id === me.id && request.status === 'pending'), empty: 'No requests need your answer in the loaded results.' },
        { heading: 'Answered for your things', rows: requests.filter(request => request.owner_id === me.id && request.status !== 'pending'), empty: 'No answered requests for your things in the loaded results.' },
        { heading: 'Your requests', rows: requests.filter(request => request.requester_id === me.id), empty: 'None of your requests are visible in the loaded results.' },
      ]).map(({ heading, rows, empty }) => <section key={heading} className={`mt-6 lg:mt-6 lg:min-w-0 lg:rounded-[14px] lg:border lg:border-slate-200 lg:bg-white lg:p-4 ${heading === 'Your requests' ? 'lg:col-start-2 lg:row-span-2 lg:row-start-1' : 'lg:col-start-1'}`} aria-label={heading}>
        <h2 className="cc-section-title lg:mb-0 lg:ml-0 lg:text-[17px] lg:tracking-normal lg:text-slate-900 lg:normal-case">{heading}</h2>
        <ul className="cc-list lg:mt-4 lg:border-0">{rows.map(request => <RequestCard key={request.id} request={request} callerId={me.id} />)}</ul>
        {!rows.length && <p className="mt-3 text-slate-600">{empty}{unavailable.length || query.isError || query.hasNextPage ? ' This list may be incomplete.' : ''}</p>}
      </section>)}
      </div>
      {query.hasNextPage && <button className="mt-6 rounded-md border border-slate-300 px-4 py-2 disabled:opacity-60" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading more…' : 'Load more requests'}</button>}
    </>}
  </main>
}
