import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, ApiError, type Cache, type Me } from '../lib/api'
import { OnboardingPage } from './OnboardingPage'
import { peekJoinToken } from './LoginPage'

export function HomePage() {
  const { session, supabase, user } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')

  const meQuery = useQuery({
    queryKey: ['me', user?.id],
    enabled: !!session,
    queryFn: () => apiFetch<Me>('/api/me', { session }),
  })
  const cachesQuery = useQuery({
    queryKey: ['caches', user?.id],
    enabled: !!session && !!meQuery.data?.display_name,
    queryFn: () => apiFetch<Cache[]>('/api/caches', { session }),
  })
  const create = useMutation({
    mutationFn: (cacheName: string) =>
      apiFetch<Cache>('/api/caches', {
        session,
        body: { name: cacheName },
        onProfileIncomplete: () => {
          void queryClient.invalidateQueries({ queryKey: ['me'] })
        },
      }),
    onSuccess: async (cache) => {
      await queryClient.invalidateQueries({ queryKey: ['caches'] })
      navigate(`/caches/${cache.id}`)
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    create.mutate(name.trim())
  }

  if (!session) return <Navigate to="/login" replace />
  if (meQuery.isPending) {
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <p className="text-slate-600">Loading profile…</p>
      </main>
    )
  }
  if (meQuery.isError) {
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <p role="alert" className="text-red-700">Could not load your profile.</p>
        <button className="mt-4 rounded-md border px-4 py-2" onClick={() => void meQuery.refetch()}>
          Try again
        </button>
      </main>
    )
  }
  const me = meQuery.data
  if (!me.display_name) return <OnboardingPage />

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Hi, {me.display_name}</h1>
        <button
          type="button"
          className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm"
          onClick={() => void supabase?.auth.signOut()}
        >
          Sign out
        </button>
      </div>
      {peekJoinToken() ? (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Invite saved. Joining will be available in the next feature.
        </p>
      ) : null}

      <section className="mt-8" aria-labelledby="my-caches">
        <h2 id="my-caches" className="text-xl font-semibold">My caches</h2>
        {cachesQuery.isPending ? <p className="mt-3 text-slate-600">Loading caches…</p> : null}
        {cachesQuery.isError ? (
          <div className="mt-3">
            <p role="alert" className="text-red-700">Could not load your caches.</p>
            <button className="mt-2 rounded-md border px-3 py-2" onClick={() => void cachesQuery.refetch()}>
              Try again
            </button>
          </div>
        ) : null}
        {cachesQuery.data?.length === 0 ? (
          <p className="mt-3 text-slate-600">No caches yet. Create one for your neighbors.</p>
        ) : null}
        <ul className="mt-3 space-y-3">
          {cachesQuery.data?.map((cache) => (
            <li key={cache.id}>
              <Link className="block break-words rounded-md border border-slate-200 bg-white px-4 py-3 font-medium" to={`/caches/${cache.id}`}>
                {cache.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="create-cache">
        <h2 id="create-cache" className="text-xl font-semibold">Create a cache</h2>
        <form className="mt-4 space-y-4" onSubmit={onSubmit}>
          <div>
            <label htmlFor="cache-name" className="block text-sm font-medium">Cache name</label>
            <input
              id="cache-name"
              required
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </div>
          {create.isError ? (
            <p role="alert" className="text-sm text-red-700">
              {create.error instanceof ApiError && create.error.code === 'invalid_name'
                ? 'Use a name between 1 and 60 characters.'
                : 'Could not create the cache. Try again.'}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={create.isPending || !name.trim()}
            className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
          >
            {create.isPending ? 'Creating…' : 'Create cache'}
          </button>
        </form>
      </section>
    </main>
  )
}
