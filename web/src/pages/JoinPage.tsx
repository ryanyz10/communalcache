import { Link, useParams } from 'react-router'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { clearJoinToken, stashJoinToken, validJoinToken } from '../lib/pendingJoin'
import { LoginForm } from './LoginPage'
import { OnboardingPage } from './OnboardingPage'

export function JoinPage() {
  const { token = '' } = useParams()
  const { me } = useAuth()
  const [storageError, setStorageError] = useState(false)
  const valid = validJoinToken(token)
  useEffect(() => {
    if (!valid) return
    try { stashJoinToken(token) }
    catch { setStorageError(true) }
  }, [token, valid])
  if (!valid) return <main className="mx-auto max-w-md px-4 py-12"><h1 className="text-2xl font-semibold">Invalid invite link</h1><Link to="/" className="underline">Go home</Link></main>
  if (storageError) return <main className="mx-auto max-w-md px-4 py-12"><p role="alert">Could not save this invite. Enable storage for this site and try again.</p></main>
  if (!me) return <LoginForm inviteToken={token} />
  if (!me.display_name) return <OnboardingPage />
  return <main className="mx-auto max-w-md px-4 py-12">
    <h1 className="text-2xl font-semibold">Your invite is saved</h1>
    <p className="mt-2 text-slate-600">Hi, {me.display_name}. Joining caches comes in the Joining feature. Keep this page to resume your invite then.</p>
    <Link to="/" onClick={clearJoinToken} className="mt-6 inline-block underline">Cancel invite and go home</Link>
  </main>
}
