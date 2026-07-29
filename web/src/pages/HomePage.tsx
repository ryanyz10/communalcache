import { useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, type Me } from '../lib/api'
import { OnboardingPage } from './OnboardingPage'
import { peekJoinToken } from './LoginPage'

export function HomePage() {
  const { session, supabase, user } = useAuth()

  const meQuery = useQuery({
    queryKey: ['me', user?.id],
    enabled: !!session,
    queryFn: () =>
      apiFetch<Me>('/api/me', {
        session,
        onProfileIncomplete: () => {
          /* routed via null display_name below */
        },
      }),
  })

  if (!session) {
    return <Navigate to="/login" replace />
  }

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
        <p role="alert" className="text-red-700">
          {meQuery.error instanceof Error
            ? meQuery.error.message
            : 'Could not load profile'}
        </p>
      </main>
    )
  }

  const me = meQuery.data
  if (!me.display_name) {
    return <OnboardingPage />
  }

  const joinToken = peekJoinToken()

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">
        Hi, {me.display_name}
      </h1>
      <p className="mt-2 text-slate-600">
        Signed in as {me.email}. Caches come next (Phase 3).
      </p>
      {joinToken ? (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Invite token saved. Phase 3 will call join with it.
        </p>
      ) : null}
      <button
        type="button"
        className="mt-6 rounded-md border border-slate-300 px-4 py-2"
        onClick={() => void supabase?.auth.signOut()}
      >
        Sign out
      </button>
    </main>
  )
}
