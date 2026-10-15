import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import type { CacheInfo, CacheSummary } from '../lib/caches'
import { destinationAfterLogin, peekJoinToken } from '../lib/pendingJoin'
import { requestPreview, useRequests } from '../lib/requests'
import { RequestStatus } from '../components/RequestStatus'
import { OnboardingPage } from './OnboardingPage'

export function HomePage() {
  const { me } = useAuth()
  const navigate = useNavigate()
  const client = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [requiresApproval, setRequiresApproval] = useState(false)
  const caches = useQuery({ queryKey: ['caches'], queryFn: () => apiFetch<CacheSummary[]>('/api/caches'), enabled: !!me?.display_name })
  const requests = useRequests(!!me?.display_name)
  const create = useMutation({
    mutationFn: () => apiFetch<CacheInfo>('/api/caches', { body: { name, requires_approval: requiresApproval } }),
    onSuccess: cache => {
      dialog.current?.close()
      void client.invalidateQueries({ queryKey: ['caches'] })
      // Creation is authoritative; do not wait for the discovery projection.
      navigate(`/caches/${cache.id}`)
    },
  })
  if (!me) return <Navigate to="/login" replace />
  if (peekJoinToken()) return <Navigate to={destinationAfterLogin()} replace />
  if (!me.display_name) return <OnboardingPage />
  const page = requests.data?.pages[0]
  const preview = requestPreview(page?.requests ?? [], me.id)
  const incomplete = !!page?.next_cursor || !!page?.unavailable_cache_ids.length || requests.isError
  function openCreate() { create.reset(); dialog.current?.showModal() }
  function onCreate(event: FormEvent) { event.preventDefault(); create.mutate() }
  return <main className="cc-page">
    <section aria-labelledby="caches-heading">
      <div className="flex items-center justify-between gap-3">
        <h1 id="caches-heading" className="text-2xl font-semibold tracking-tight">Your caches</h1>
        <button type="button" className="cc-pill" onClick={openCreate}>+ New cache</button>
      </div>
      {caches.isPending && <p role="status" className="mt-3">Loading caches…</p>}
      {caches.isError && <div className="mt-3"><p role="alert" className="text-red-700">{errorMessage(caches.error)} Previously loaded caches may be out of date.</p><button className="mt-2 text-sm underline" onClick={() => void caches.refetch()}>Try caches again</button></div>}
      {!!caches.data?.length && <ul className="cc-list mt-3">{caches.data.map(cache => <li key={cache.id} className="border-t border-slate-100 first:border-t-0"><Link to={`/caches/${cache.id}`} className="flex items-center gap-3 px-4 py-3.5">
        <span className="min-w-0 flex-1 break-words font-semibold">{cache.name}</span><span aria-hidden="true" className="text-xl leading-none text-slate-500">›</span>
      </Link></li>)}</ul>}
      {caches.isSuccess && !caches.data.length && <div className="mt-3 rounded-[10px] border border-slate-200 bg-white p-4"><p className="text-sm text-slate-600">No caches yet. Create one to start sharing. New entries can take a moment to appear.</p><button type="button" className="cc-outline mt-3" onClick={openCreate}>New cache</button></div>}
    </section>
    <section className="mt-8" aria-labelledby="preview-heading">
      <div className="flex items-center justify-between gap-3"><h2 id="preview-heading" className="text-xl font-semibold">Requests</h2><Link to="/requests" className="text-sm underline">See all</Link></div>
      {requests.isPending && <p role="status" className="mt-3">Loading requests…</p>}
      {requests.isError && <p role="alert" className="mt-3 text-red-700">{errorMessage(requests.error)} Requests may be unavailable. Open See all to try again.</p>}
      {incomplete && <p className="mt-3 text-sm text-amber-800">This preview may be incomplete. See all requests for more caches.</p>}
      {!!preview.length && <ul className="cc-list mt-3">{preview.map(request => <li key={request.id} className="border-t border-slate-100 first:border-t-0"><Link to={`/caches/${request.cache_id}/items/${request.item_id}`} className="flex items-center gap-3 px-4 py-3.5">
        <div className="min-w-0 flex-1"><p className="break-words font-semibold">{request.owner_id === me.id ? `${request.requester_name ?? 'A neighbor'} wants${request.quantity === null ? ' to use' : ` ${request.quantity}`} ${request.item_title}` : `You asked ${request.owner_name ?? 'a neighbor'} for ${request.item_title}`}</p><p className="mt-0.5 text-sm text-slate-600">{request.cache_name}{request.owner_id === me.id ? ' · needs your answer' : ''}</p></div>
        <RequestStatus status={request.status} />
      </Link></li>)}</ul>}
      {requests.isSuccess && !preview.length && <p className="mt-3 text-sm text-slate-600">{incomplete ? 'No requests visible in this preview yet.' : 'No requests yet. Ask to use something from a cache.'}</p>}
    </section>
    <dialog ref={dialog} className="cc-sheet" aria-labelledby="new-cache-heading" onCancel={event => { if (create.isPending) event.preventDefault() }}>
      <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />
      <h2 id="new-cache-heading" className="text-xl font-semibold">New cache</h2>
      <form className="mt-4 space-y-4" onSubmit={onCreate}>
        <div><label htmlFor="cache-name" className="block text-sm font-medium">Name</label><input autoFocus id="cache-name" type="text" required maxLength={60} value={name} onChange={event => setName(event.target.value)} className="cc-input" /></div>
        <label className="flex items-center justify-between gap-3"><span><span className="block font-medium">Approve new members</span><span className="block text-sm text-slate-600">Off: anyone with the invite joins right away.</span></span><input type="checkbox" role="switch" aria-checked={requiresApproval} checked={requiresApproval} onChange={event => setRequiresApproval(event.target.checked)} className="cc-switch" /></label>
        {create.isError && <p role="alert" className="text-red-700">{errorMessage(create.error)}</p>}
        <div className="flex gap-3"><button type="submit" disabled={create.isPending || !name.trim()} className="flex-1 rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60">{create.isPending ? 'Creating…' : 'Create cache'}</button><button type="button" disabled={create.isPending} onClick={() => dialog.current?.close()} className="rounded-md border border-slate-300 px-4 py-2">Cancel</button></div>
      </form>
    </dialog>
  </main>
}
