import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, ApiError, type Cache, type CacheDetail, type Me } from '../lib/api'
import { OnboardingPage } from './OnboardingPage'

export function CachePage() {
  const { id } = useParams()
  const { session, user } = useAuth()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [requiresApproval, setRequiresApproval] = useState(false)
  const [copyState, setCopyState] = useState('')

  const meQuery = useQuery({
    queryKey: ['me', user?.id],
    enabled: !!session,
    queryFn: () => apiFetch<Me>('/api/me', { session }),
  })
  const cacheQuery = useQuery({
    queryKey: ['cache', id, user?.id],
    enabled: !!session && !!id,
    queryFn: () => apiFetch<CacheDetail>(`/api/caches/${id}`, { session }),
  })
  const cache = cacheQuery.data
  const cacheName = cache?.name
  const cacheApproval = cache?.requires_approval
  useEffect(() => {
    if (cacheName === undefined || cacheApproval === undefined) return
    setName(cacheName)
    setRequiresApproval(cacheApproval)
    setCopyState('')
  }, [id, cacheName, cacheApproval])

  function onProfileIncomplete() {
    void queryClient.invalidateQueries({ queryKey: ['me'] })
  }
  async function refreshCache() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['cache', id] }),
      queryClient.invalidateQueries({ queryKey: ['caches'] }),
    ])
  }
  const save = useMutation({
    mutationFn: () =>
      apiFetch<Cache>(`/api/caches/${id}`, {
        method: 'PATCH',
        session,
        body: { name: name.trim(), requires_approval: requiresApproval },
        onProfileIncomplete,
      }),
    onSuccess: refreshCache,
  })
  const rotate = useMutation({
    mutationFn: () =>
      apiFetch<Cache>(`/api/caches/${id}/invite/rotate`, {
        method: 'POST', session, onProfileIncomplete,
      }),
    onSuccess: async () => {
      setCopyState('')
      await refreshCache()
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }
  async function copyInvite() {
    if (!cache) return
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join/${cache.invite_token}`)
      setCopyState('Invite link copied.')
    } catch {
      setCopyState('Could not copy. Select the link above and copy it manually.')
    }
  }

  if (meQuery.isPending || cacheQuery.isPending) {
    return <main className="mx-auto max-w-md px-4 py-8"><p>Loading cache…</p></main>
  }
  if (meQuery.isError || cacheQuery.isError) {
    const notFound = cacheQuery.error instanceof ApiError && cacheQuery.error.status === 404
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <Link to="/" className="underline">Back to my caches</Link>
        <p role="alert" className="mt-4 text-red-700">
          {notFound ? 'Cache not found.' : 'Could not load this cache.'}
        </p>
        {!notFound ? (
          <button className="mt-4 rounded-md border px-4 py-2" onClick={() => {
            void meQuery.refetch()
            void cacheQuery.refetch()
          }}>Try again</button>
        ) : null}
      </main>
    )
  }
  if (!meQuery.data.display_name) return <OnboardingPage />
  if (!cache) return null

  const isOwner = cache.owner_id === user?.id
  const busy = save.isPending || rotate.isPending
  const inviteLink = `${window.location.origin}/join/${cache.invite_token}`

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link to="/" className="text-sm underline">Back to my caches</Link>
      <h1 className="mt-4 break-words text-2xl font-semibold tracking-tight">{cache.name}</h1>

      <section className="mt-8" aria-labelledby="invite-heading">
        <h2 id="invite-heading" className="text-xl font-semibold">Invite link</h2>
        <p className="mt-2 text-sm text-slate-600">
          Anyone with this link can ask to join. Joining ships in the next feature.
        </p>
        <label htmlFor="invite-link" className="mt-3 block text-sm font-medium">Share this link</label>
        <input
          id="invite-link"
          readOnly
          value={inviteLink}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" disabled={rotate.isPending} onClick={() => void copyInvite()} className="rounded-md border border-slate-300 px-4 py-2 disabled:opacity-60">
            Copy invite link
          </button>
          {isOwner ? (
            <button type="button" disabled={busy} className="rounded-md border border-slate-300 px-4 py-2 disabled:opacity-60" onClick={() => {
              if (window.confirm('Rotate the invite link? The old link will stop working.')) rotate.mutate()
            }}>
              {rotate.isPending ? 'Rotating…' : 'Rotate invite link'}
            </button>
          ) : null}
        </div>
        <p role="status" className="mt-2 text-sm text-slate-600">{copyState}</p>
        {rotate.isError ? <p role="alert" className="mt-2 text-sm text-red-700">Could not rotate the link. Try again.</p> : null}
      </section>

      <section className="mt-8" aria-labelledby="members-heading">
        <h2 id="members-heading" className="text-xl font-semibold">Members</h2>
        <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white px-4">
          {cache.members.map((member) => (
            <li key={member.user_id} className="break-words py-3">
              {member.display_name ?? 'Member'}
              {member.user_id === cache.owner_id ? <span className="ml-2 text-sm text-slate-500">Owner</span> : null}
            </li>
          ))}
        </ul>
      </section>

      {isOwner ? (
        <section className="mt-8" aria-labelledby="settings-heading">
          <h2 id="settings-heading" className="text-xl font-semibold">Owner settings</h2>
          <form className="mt-4 space-y-4" onSubmit={onSubmit}>
            <div>
              <label htmlFor="edit-cache-name" className="block text-sm font-medium">Cache name</label>
              <input id="edit-cache-name" required maxLength={60} value={name} disabled={busy}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
            </div>
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={requiresApproval} disabled={busy} onChange={(event) => setRequiresApproval(event.target.checked)} className="mt-1" />
              <span>Require owner approval to join</span>
            </label>
            {save.isError ? (
              <p role="alert" className="text-sm text-red-700">
                {save.error instanceof ApiError && save.error.code === 'invalid_name'
                  ? 'Use a name between 1 and 60 characters.' : 'Could not save settings. Try again.'}
              </p>
            ) : null}
            {save.isSuccess ? <p role="status" className="text-sm text-slate-600">Settings saved.</p> : null}
            <button type="submit" disabled={busy || !name.trim()} className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60">
              {save.isPending ? 'Saving…' : 'Save settings'}
            </button>
          </form>
        </section>
      ) : null}
    </main>
  )
}
