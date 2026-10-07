import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, ApiError, type JoinResult, type Me } from '../lib/api'
import { clearJoinToken, stashJoinToken } from '../lib/joinToken'
import { OnboardingPage } from './OnboardingPage'

export function JoinPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { session, ready, user } = useAuth()
  const queryClient = useQueryClient()
  const attempted = useRef<string | null>(null)

  useEffect(() => {
    if (token) stashJoinToken(token)
  }, [token])

  const meQuery = useQuery({
    queryKey: ['me', user?.id],
    enabled: ready && !!session,
    queryFn: () => apiFetch<Me>('/api/me', { session }),
  })
  const join = useMutation({
    mutationFn: (invite: string) =>
      apiFetch<JoinResult>(`/api/join/${encodeURIComponent(invite)}`, {
        method: 'POST', session,
        onProfileIncomplete: () => {
          void queryClient.invalidateQueries({ queryKey: ['me'] })
        },
      }),
    onSuccess: (result) => {
      clearJoinToken()
      void queryClient.invalidateQueries({ queryKey: ['caches'] })
      void queryClient.invalidateQueries({ queryKey: ['cache', result.cache_id] })
      if (result.status === 'active') navigate(`/caches/${result.cache_id}`, { replace: true })
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) clearJoinToken()
      if (error instanceof ApiError && error.code === 'profile_incomplete') attempted.current = null
    },
  })
  const { mutate } = join
  const displayName = meQuery.data?.display_name
  useEffect(() => {
    if (!ready || !session || !token || !displayName) return
    const key = `${user?.id}:${token}`
    if (attempted.current === key) return
    attempted.current = key
    mutate(token)
  }, [ready, session, token, displayName, user?.id, mutate])

  if (!ready) return <main className="mx-auto max-w-md px-4 py-12"><p>Opening invite…</p></main>
  if (!session) return <Navigate to="/login" replace />
  if (meQuery.isPending) return <main className="mx-auto max-w-md px-4 py-12"><p>Loading profile…</p></main>
  if (meQuery.isError) {
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <p role="alert" className="text-red-700">Could not load your profile.</p>
        <button className="mt-4 rounded-md border px-4 py-2" onClick={() => void meQuery.refetch()}>Try again</button>
      </main>
    )
  }
  if (!meQuery.data.display_name) return <OnboardingPage />

  const removed = join.error instanceof ApiError && join.error.status === 403
  const invalid = !token || (join.error instanceof ApiError && join.error.status === 404)
  const pending = join.variables === token && join.data?.status === 'pending'

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">
        {pending ? 'Waiting for approval' : 'Join a cache'}
      </h1>
      {join.isPending || join.isIdle ? <p className="mt-4 text-slate-600">Joining…</p> : null}
      {pending && !join.isPending ? (
        <p role="status" className="mt-4 text-slate-600">Waiting for the owner to approve your join request.</p>
      ) : null}
      {join.isError || invalid ? (
        <p role="alert" className="mt-4 text-red-700">
          {removed ? 'You were removed from this cache and cannot rejoin with this invite.'
            : invalid ? 'This invite is invalid or has been rotated. Ask a member for a new link.'
              : 'Could not join right now. Please try again.'}
        </p>
      ) : null}
      {!removed && !invalid && !join.isPending && (pending || join.isError) && token ? (
        <button type="button" className="mt-4 rounded-md border border-slate-300 px-4 py-2" onClick={() => mutate(token)}>
          Try joining again
        </button>
      ) : null}
      <Link to="/" className="mt-6 block text-sm underline">Back to my caches</Link>
    </main>
  )
}
