import { Link, useParams } from 'react-router'
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { joinFromToken } from '../lib/joining'
import { errorMessage } from '../lib/api'
import { useAuth } from '../auth/AuthProvider'
import { clearJoinToken, stashJoinToken, validJoinToken } from '../lib/pendingJoin'
import { LoginForm } from './LoginPage'
import { OnboardingPage } from './OnboardingPage'

export function JoinPage() {
  const { token = '' } = useParams()
  const { me } = useAuth()
  const [storageError, setStorageError] = useState(false)
  const queryClient = useQueryClient()
  const join = useMutation({
    mutationFn: () => joinFromToken(token),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['caches'] }) },
  })
  const valid = validJoinToken(token)
  useEffect(() => {
    if (!valid) return
    try { stashJoinToken(token) }
    catch { setStorageError(true) }
  }, [token, valid])
  if (!valid) return <main className="cc-page"><h1 className="text-2xl font-semibold">Invalid invite link</h1><Link to="/" className="underline">Go home</Link></main>
  if (storageError) return <main className="cc-page"><p role="alert">Could not save this invite. Enable storage for this site and try again.</p></main>
  if (!me) return <LoginForm inviteToken={token} />
  if (!me.display_name) return <OnboardingPage />
  if (join.isSuccess) return <main className="cc-page">
    <h1 className="text-2xl font-semibold">{join.data.status === 'active' ? `Welcome to ${join.data.name}` : 'Waiting for owner approval'}</h1>
    {join.data.status === 'pending' && <p role="status" className="mt-2 text-slate-600">Your request to join {join.data.name} is saved. The owner can approve it from their cache page.</p>}
    <Link to={join.data.status === 'active' ? `/caches/${join.data.cache_id}` : '/'} className="mt-6 inline-block underline">{join.data.status === 'active' ? 'Open cache' : 'Go home'}</Link>
  </main>
  return <main className="cc-page">
    <h1 className="text-2xl font-semibold">Join this cache</h1>
    <p className="mt-2 text-slate-600">Hi, {me.display_name}. If this cache requires approval, its owner will review your request.</p>
    {join.isError && <p role="alert" className="mt-4 text-red-700">{errorMessage(join.error)}</p>}
    <button type="button" disabled={join.isPending} onClick={() => join.mutate()} className="cc-pill mt-6">{join.isPending ? 'Joining…' : 'Join cache'}</button>
    <Link to="/" onClick={()=>clearJoinToken(token)} className="mt-6 ml-4 inline-block underline">Cancel invite and go home</Link>
  </main>
}
