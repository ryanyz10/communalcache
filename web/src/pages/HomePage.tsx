import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import type { CacheInfo, CacheSummary } from '../lib/caches'
import { destinationAfterLogin, peekJoinToken } from '../lib/pendingJoin'
import { OnboardingPage } from './OnboardingPage'
import { PushControls } from './PushControls'

export function HomePage() {
  const { me, signOut } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [requiresApproval, setRequiresApproval] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const caches = useQuery({queryKey:['caches'],queryFn:()=>apiFetch<CacheSummary[]>('/api/caches'),enabled:!!me?.display_name})
  const create = useMutation({
    mutationFn:()=>apiFetch<CacheInfo>('/api/caches',{body:{name,requires_approval:requiresApproval}}),
    onSuccess:(cache)=>{
      void queryClient.invalidateQueries({queryKey:['caches']})
      // Creation is authoritative now; do not wait for the D1 home projection.
      navigate(`/caches/${cache.id}`)
    },
  })
  if (!me) return <Navigate to="/login" replace />
  if (peekJoinToken()) return <Navigate to={destinationAfterLogin()} replace />
  if (!me.display_name) return <OnboardingPage />
  async function logout() {
    setPending(true)
    setError(null)
    try { await signOut() }
    catch (error) { setError(errorMessage(error)) }
    finally { setPending(false) }
  }
  function onCreate(event:FormEvent) { event.preventDefault();create.mutate() }
  return <main className="mx-auto max-w-md px-4 py-8">
    <h1 className="text-2xl font-semibold tracking-tight">Hi, {me.display_name}</h1>
    <p className="mt-2 text-slate-600">Your community's shared things, in one place.</p>
    <Link to="/requests" className="mt-4 inline-block underline">Your requests</Link>
    <section className="mt-8" aria-labelledby="caches-heading">
      <div className="flex items-center justify-between gap-4">
        <h2 id="caches-heading" className="text-xl font-semibold">Your caches</h2>
        <button type="button" onClick={()=>void caches.refetch()} disabled={caches.isFetching} className="underline">Refresh</button>
      </div>
      {caches.isPending && <p role="status" className="mt-3">Loading caches…</p>}
      {caches.isError && <p role="alert" className="mt-3 text-red-700">{errorMessage(caches.error)} Previously loaded caches may be out of date.</p>}
      {caches.data && <>
        {caches.isSuccess && caches.data.length === 0 && <p className="mt-3 text-slate-600">No caches yet. Create one to start sharing. New entries can take a moment to appear.</p>}
        <ul className="mt-3 space-y-3">{caches.data.map(cache=><li key={cache.id}><Link to={`/caches/${cache.id}`} className="block rounded-md border border-slate-300 bg-white p-4 font-medium">{cache.name}</Link></li>)}</ul>
      </>}
    </section>
    <section className="mt-8" aria-labelledby="create-heading">
      <h2 id="create-heading" className="text-xl font-semibold">Create a cache</h2>
      <form className="mt-4 space-y-4" onSubmit={onCreate}>
        <div>
          <label htmlFor="cache-name" className="block text-sm font-medium">Cache name</label>
          <input id="cache-name" type="text" required maxLength={60} value={name} onChange={event=>setName(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={requiresApproval} onChange={event=>setRequiresApproval(event.target.checked)} />Require owner approval to join</label>
        {create.isError && <p role="alert" className="text-red-700">{errorMessage(create.error)}</p>}
        <button type="submit" disabled={create.isPending || !name.trim()} className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60">{create.isPending?'Creating…':'Create cache'}</button>
      </form>
    </section>
    <PushControls userId={me.id} />
    {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
    <button type="button" disabled={pending} className="mt-8 rounded-md border border-slate-300 px-4 py-2" onClick={()=>void logout()}>{pending?'Signing out…':'Sign out'}</button>
  </main>
}
