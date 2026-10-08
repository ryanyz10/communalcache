import { useState } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/api'
import { destinationAfterLogin, peekJoinToken } from '../lib/pendingJoin'
import { OnboardingPage } from './OnboardingPage'

export function HomePage() {
  const { me, signOut } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
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
  return <main className="mx-auto max-w-md px-4 py-12">
    <h1 className="text-2xl font-semibold tracking-tight">Hi, {me.display_name}</h1>
    <p className="mt-2 text-slate-600">Signed in as {me.email}. Creating and sharing caches comes next.</p>
    {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
    <button type="button" disabled={pending} className="mt-6 rounded-md border border-slate-300 px-4 py-2" onClick={() => void logout()}>
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  </main>
}
