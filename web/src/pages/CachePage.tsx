import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import type { CacheDetail } from '../lib/caches'
import type { JoinRequest } from '../lib/joining'
import { shareInvite } from '../lib/invites'
import { OnboardingPage } from './OnboardingPage'
import { ItemList } from './ItemPages'
import { WideBreadcrumbs } from '../components/WideBreadcrumbs'

export function CachePage() {
  const { cacheId = '' } = useParams()
  const { me } = useAuth()
  const [status, setStatus] = useState('')
  const query = useQuery({ queryKey: ['cache', cacheId], queryFn: () => apiFetch<CacheDetail>(`/api/caches/${cacheId}`), enabled: !!me?.display_name })
  const joins = useQuery({ queryKey: ['join-requests', cacheId], queryFn: () => apiFetch<JoinRequest[]>(`/api/caches/${cacheId}/join-requests`), enabled: !!me?.display_name && query.data?.owner_id === me.id })
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  if (query.isPending) return <main className="cc-page lg:max-w-[1120px] lg:p-8"><p role="status">Loading cache…</p></main>
  if (query.isError) return <main className="cc-page lg:max-w-[1120px] lg:p-8"><Link to="/" className="text-sm underline">‹ Your caches</Link><p role="alert" className="mt-4 text-red-700">{errorMessage(query.error)}</p><button className="mt-4 underline" onClick={() => void query.refetch()}>Try again</button></main>
  const cache = query.data
  async function invite() {
    try { setStatus(await shareInvite(new URL(`/join/${cache.invite_token}`, location.origin).href)) }
    catch { setStatus('Could not share or copy. Open Cache settings to select the invite link.') }
  }
  return <main className="cc-page lg:max-w-[1120px] lg:p-8">
    <WideBreadcrumbs><Link to="/">Caches</Link><span aria-hidden="true">›</span><span>{cache.name}</span></WideBreadcrumbs>
    <Link to="/" className="text-sm underline lg:hidden">‹ Your caches</Link>
    <div className="mt-3 flex items-center justify-between gap-3">
      <div className="min-w-0"><h1 className="break-words text-2xl font-semibold tracking-tight lg:text-[28px] lg:font-bold">{cache.name}</h1><p className="text-sm text-slate-600">{cache.members.length} {cache.members.length === 1 ? 'member' : 'members'}</p></div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" className="cc-outline" onClick={() => void invite()}>Invite</button>
        <Link to={`/caches/${cache.id}/settings`} aria-label="Cache settings" className="flex size-[38px] items-center justify-center rounded-full border border-slate-300 bg-white lg:w-auto lg:px-3.5 lg:text-sm lg:font-medium">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="lg:hidden"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>
          <span className="hidden lg:inline">Settings</span>
        </Link>
        <Link to={`/caches/${cache.id}/items/new`} className="hidden lg:inline-flex lg:items-center lg:rounded-full lg:bg-slate-900 lg:px-3.5 lg:py-1.5 lg:text-sm lg:font-medium lg:text-white">+ Add item</Link>
      </div>
    </div>
    {status && <p role="status" className="mt-3 text-sm">{status}</p>}
    {cache.owner_id === me.id && joins.isError && <p role="alert" className="mt-4 text-sm text-red-700">Join requests could not be loaded. <Link to={`/caches/${cache.id}/settings`} className="underline">Open settings to try again.</Link></p>}
    {cache.owner_id === me.id && !!joins.data?.length && <div className="mt-4 flex items-center justify-between gap-2 rounded-[10px] border border-amber-200 bg-amber-100 px-3.5 py-3 text-sm text-amber-900"><span><b>{joins.data.length} {joins.data.length === 1 ? 'person' : 'people'}</b> {joins.data.length === 1 ? 'wants' : 'want'} to join</span><Link to={`/caches/${cache.id}/settings`} className="underline">Review</Link></div>}
    <ItemList cacheId={cache.id} />
  </main>
}
