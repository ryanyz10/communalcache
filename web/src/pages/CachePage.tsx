import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import type { CacheDetail, CacheInfo } from '../lib/caches'
import { OnboardingPage } from './OnboardingPage'
import { JoinRequests } from './JoinRequests'

function OwnerSettings({cache}:{cache:CacheDetail}) {
  const queryClient=useQueryClient()
  const [name,setName]=useState(cache.name)
  const [requiresApproval,setRequiresApproval]=useState(cache.requires_approval)
  const update=useMutation({
    mutationFn:()=>apiFetch<CacheInfo>(`/api/caches/${cache.id}`,{method:'PATCH',body:{name,requires_approval:requiresApproval}}),
    onSuccess:async()=>{
      await queryClient.invalidateQueries({queryKey:['cache',cache.id]})
      await queryClient.invalidateQueries({queryKey:['caches']})
    },
  })
  function onSubmit(event:FormEvent) {event.preventDefault();update.mutate()}
  return <section className="mt-8" aria-labelledby="settings-heading">
    <h2 id="settings-heading" className="text-xl font-semibold">Owner settings</h2>
    <form className="mt-4 space-y-4" onSubmit={onSubmit}>
      <div><label htmlFor="settings-name" className="block text-sm font-medium">Cache name</label>
        <input id="settings-name" type="text" required maxLength={60} value={name} onChange={event=>setName(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={requiresApproval} onChange={event=>setRequiresApproval(event.target.checked)} />Require owner approval to join</label>
      {update.isError && <p role="alert" className="text-red-700">{errorMessage(update.error)}</p>}
      {update.isSuccess && <p role="status" className="text-emerald-700">Settings saved.</p>}
      <button type="submit" disabled={update.isPending || !name.trim()} className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60">{update.isPending?'Saving…':'Save settings'}</button>
    </form>
  </section>
}

export function CachePage() {
  const {cacheId=''}=useParams()
  const {me}=useAuth()
  const queryClient=useQueryClient()
  const membersDialog=useRef<HTMLDialogElement>(null)
  const rotateDialog=useRef<HTMLDialogElement>(null)
  const [copyStatus,setCopyStatus]=useState('')
  const [rotationStatus,setRotationStatus]=useState('')
  const query=useQuery({queryKey:['cache',cacheId],queryFn:()=>apiFetch<CacheDetail>(`/api/caches/${cacheId}`),enabled:!!me?.display_name})
  const rotate=useMutation({
    mutationFn:()=>apiFetch<CacheInfo>(`/api/caches/${cacheId}/invite/rotate`,{body:{}}),
    onSuccess:async()=>{
      rotateDialog.current?.close()
      setCopyStatus('')
      setRotationStatus('Invite rotated. The old link no longer works.')
      await queryClient.invalidateQueries({queryKey:['cache',cacheId]})
    },
  })
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  if (query.isPending) return <main className="mx-auto max-w-md px-4 py-8"><p role="status">Loading cache…</p></main>
  if (query.isError) return <main className="mx-auto max-w-md px-4 py-8"><Link to="/" className="underline">Your caches</Link><p role="alert" className="mt-4 text-red-700">{errorMessage(query.error)}</p><button className="mt-4 underline" onClick={()=>void query.refetch()}>Try again</button></main>
  const cache=query.data
  const owner=me.id===cache.owner_id
  const invite=new URL(`/join/${cache.invite_token}`,location.origin).href
  async function copyInvite() {
    try {await navigator.clipboard.writeText(invite);setCopyStatus('Invite copied.')}
    catch {setCopyStatus('Could not copy automatically. Select the invite link below and copy it.')}
  }
  return <main className="mx-auto max-w-md px-4 py-8">
    <Link to="/" className="underline">Your caches</Link>
    <h1 className="mt-4 text-2xl font-semibold tracking-tight">{cache.name}</h1>
    <p className="mt-2 text-slate-600">{cache.requires_approval?'New members need owner approval.':'Anyone with the invite can join.'}</p>
    <button type="button" className="mt-4 rounded-md border border-slate-300 px-4 py-2" onClick={()=>membersDialog.current?.showModal()}>Members ({cache.members.length})</button>
    <section className="mt-8" aria-labelledby="invite-heading">
      <h2 id="invite-heading" className="text-xl font-semibold">Share an invite</h2>
      <p className="mt-2 text-slate-600">Share only with people you trust.</p>
      <label htmlFor="invite-link" className="mt-3 block text-sm font-medium">Invite link</label>
      <input id="invite-link" type="text" readOnly value={invite} onFocus={event=>event.currentTarget.select()} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
      <button type="button" className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-white" onClick={()=>void copyInvite()}>Copy invite</button>
      {copyStatus && <p role="status" className="mt-3">{copyStatus}</p>}
      {owner && <button type="button" className="ml-3 rounded-md border border-slate-300 px-4 py-2" onClick={()=>{rotate.reset();rotateDialog.current?.showModal()}}>Rotate invite</button>}
      {rotationStatus && <p role="status" className="mt-3 text-emerald-700">{rotationStatus}</p>}
    </section>
    <section className="mt-8" aria-labelledby="items-heading"><h2 id="items-heading" className="text-xl font-semibold">Shared things</h2><p className="mt-2 text-slate-600">Adding and browsing items comes in the Items feature.</p></section>
    {owner && <JoinRequests cacheId={cache.id} />}
    {owner && <OwnerSettings cache={cache} />}
    <dialog ref={membersDialog} className="w-[calc(100%-2rem)] max-w-md rounded-lg bg-white p-6 text-slate-900" aria-labelledby="members-heading">
      <h2 id="members-heading" className="text-xl font-semibold">Members</h2>
      <ul className="mt-4 space-y-2">{cache.members.map(member=><li key={member.user_id}>{member.display_name??'Member'}{member.user_id===cache.owner_id?' · Owner':''}</li>)}</ul>
      <form method="dialog"><button className="mt-6 rounded-md border border-slate-300 px-4 py-2">Close members</button></form>
    </dialog>
    <dialog ref={rotateDialog} className="w-[calc(100%-2rem)] max-w-md rounded-lg bg-white p-6 text-slate-900" aria-labelledby="rotate-heading">
      <h2 id="rotate-heading" className="text-xl font-semibold">Rotate this invite?</h2>
      <p className="mt-3">The old link will stop working. Existing members keep access.</p>
      {rotate.isError && <p role="alert" className="mt-3 text-red-700">{errorMessage(rotate.error)}</p>}
      <div className="mt-6 flex gap-3">
        <button type="button" disabled={rotate.isPending} onClick={()=>rotateDialog.current?.close()} className="rounded-md border border-slate-300 px-4 py-2">Cancel</button>
        <button type="button" disabled={rotate.isPending} onClick={()=>rotate.mutate()} className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60">{rotate.isPending?'Rotating…':'Confirm rotation'}</button>
      </div>
    </dialog>
  </main>
}
