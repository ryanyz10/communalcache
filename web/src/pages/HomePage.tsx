import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import type { CacheInfo, CacheSummary } from '../lib/caches'
import { destinationAfterLogin, peekJoinToken } from '../lib/pendingJoin'
import { OnboardingPage } from './OnboardingPage'
import { LibrarySection } from './LibraryPage'
import { CacheBox, PixelHorizon } from '../components/PixelArt'
import { LandingPage } from './LandingPage'
import { JoinInviteSheet } from './JoinInviteSheet'

export function HomePage() {
  const { me } = useAuth()
  const navigate = useNavigate()
  const client = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null), joinDialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [requiresApproval, setRequiresApproval] = useState(false)
  const caches = useQuery({ queryKey: ['caches'], queryFn: () => apiFetch<CacheSummary[]>('/api/caches'), enabled: !!me?.display_name })
  const create = useMutation({
    mutationFn: () => apiFetch<CacheInfo>('/api/caches', { body: { name, requires_approval: requiresApproval } }),
    onSuccess: cache => {
      dialog.current?.close()
      void client.invalidateQueries({ queryKey: ['caches'] })
      navigate(`/caches/${cache.id}`)
    },
  })
  if (!me) return <LandingPage />
  if (peekJoinToken()) return <Navigate to={destinationAfterLogin()} replace />
  if (!me.display_name) return <OnboardingPage />
  function openCreate() { create.reset(); dialog.current?.showModal() }
  function onCreate(event: FormEvent) { event.preventDefault(); create.mutate() }
  return <main className="cc-page lg:max-w-[1200px] lg:p-8">
    <section aria-labelledby="caches-heading">
      <div className="cc-hero"><div className="flex items-center justify-between gap-3">
        <h1 id="caches-heading" className="text-2xl font-semibold tracking-tight lg:text-[28px] lg:font-bold">Your caches</h1>
        <div className="flex shrink-0 flex-col items-end gap-2 lg:flex-row"><button type="button" className="cc-pill min-h-11" onClick={openCreate}>+ New cache</button><button type="button" className="cc-outline min-h-11" aria-haspopup="dialog" onClick={()=>joinDialog.current?.showModal()}>Join with an invite</button></div>
      </div>
      <PixelHorizon kind="boxes" entries={(caches.data ?? []).map(cache=>({...cache,to:`/caches/${cache.id}`}))} /></div>
      {caches.isPending && <p role="status" className="mt-3">Loading caches…</p>}
      {caches.isError && <div className="mt-3"><p role="alert" className="text-red-700">{errorMessage(caches.error)} Previously loaded caches may be out of date.</p><button className="mt-2 text-sm underline" onClick={() => void caches.refetch()}>Try caches again</button></div>}
      {!!caches.data?.length && <ul className="cc-list mt-3 lg:mt-6 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] lg:gap-4 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent">{caches.data.map(cache => <li key={cache.id} className="border-t border-slate-100 first:border-t-0 lg:border-0"><Link to={`/caches/${cache.id}`} className="flex items-center gap-3 px-4 py-3.5 lg:grid lg:min-h-[118px] lg:grid-cols-[1fr_auto] lg:gap-y-3.5 lg:rounded-[14px] lg:border lg:border-slate-200 lg:bg-white lg:p-[18px]">
        <span aria-hidden="true" className="hidden lg:flex lg:size-10 lg:items-center lg:justify-center lg:rounded-[10px] lg:bg-indigo-100 lg:font-bold lg:text-indigo-800"><CacheBox name={cache.name} /></span>
        <span className="min-w-0 flex-1 break-words font-semibold lg:col-span-2 lg:row-start-2">{cache.name}</span><span aria-hidden="true" className="text-xl leading-none text-slate-500 lg:col-start-2 lg:row-start-1">›</span>
      </Link></li>)}</ul>}
      {caches.isSuccess && !caches.data.length && <div className="mt-3 rounded-[10px] border border-slate-200 bg-white p-4"><p className="text-sm text-slate-600">No caches yet. Create one to start sharing.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="cc-outline min-h-11" onClick={openCreate}>New cache</button><button type="button" className="cc-outline min-h-11" aria-haspopup="dialog" onClick={()=>joinDialog.current?.showModal()}>Join with an invite</button></div></div>}
    </section>
    <LibrarySection preview />
    <JoinInviteSheet dialog={joinDialog} />
    <dialog ref={dialog} className="cc-sheet lg:w-[440px] lg:rounded-2xl lg:p-6" aria-labelledby="new-cache-heading" onCancel={event => { if (create.isPending) event.preventDefault() }}>
      <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 lg:hidden" />
      <h2 id="new-cache-heading" className="text-xl font-semibold">New cache</h2>
      <form className="mt-4 space-y-4" onSubmit={onCreate}>
        <div><label htmlFor="cache-name" className="block text-sm font-medium">Name</label><input autoFocus id="cache-name" type="text" required maxLength={60} value={name} onChange={event => setName(event.target.value)} className="cc-input" /></div>
        <label className="flex items-center justify-between gap-3"><span><span className="block font-medium">Approve new members</span><span className="block text-sm text-slate-600">Off: anyone with the invite joins right away.</span></span><input type="checkbox" role="switch" aria-checked={requiresApproval} checked={requiresApproval} onChange={event => setRequiresApproval(event.target.checked)} className="cc-switch" /></label>
        {create.isError && <p role="alert" className="text-red-700">{errorMessage(create.error)}</p>}
        <div className="flex gap-3 lg:flex-row-reverse lg:justify-start"><button type="submit" disabled={create.isPending || !name.trim()} className="flex-1 rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60 lg:flex-none">{create.isPending ? 'Creating…' : 'Create cache'}</button><button type="button" disabled={create.isPending} onClick={() => dialog.current?.close()} className="rounded-md border border-slate-300 px-4 py-2">Cancel</button></div>
      </form>
    </dialog>
  </main>
}
