import { Link, useParams } from 'react-router'
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { joinFromToken } from '../lib/joining'
import { errorMessage } from '../lib/api'
import { useAuth } from '../auth/AuthProvider'
import { clearJoinToken, stashJoinToken, validJoinToken } from '../lib/pendingJoin'
import { LoginForm } from './LoginPage'
import { OnboardingPage } from './OnboardingPage'
import { AuthBrand, AuthScreen } from '../components/AuthScreen'
import { InviteBox } from '../components/InviteBox'

export function JoinPage() {
  const { token = '' } = useParams(), { me } = useAuth()
  const [storageError, setStorageError] = useState(false)
  const client = useQueryClient()
  const join = useMutation({ mutationFn: () => joinFromToken(token), onSuccess: () => { void client.invalidateQueries({queryKey:['caches']}) } })
  const valid = validJoinToken(token)
  useEffect(() => {
    if (!valid) return
    try { stashJoinToken(token) } catch { setStorageError(true) }
  }, [token, valid])
  if (!valid) return <AuthScreen className="cc-auth-recovery"><h1>Invalid invite link</h1><Link to="/" className="cc-profile-secondary">Go home</Link></AuthScreen>
  if (storageError) return <AuthScreen className="cc-auth-recovery"><p role="alert">Could not save this invite. Enable storage for this site and try again.</p></AuthScreen>
  if (!me) return <LoginForm inviteToken={token} />
  if (!me.display_name) return <OnboardingPage />
  if (join.isSuccess) {
    const pending = join.data.status === 'pending'
    return <AuthScreen className="cc-join-result">
      <InviteBox name={join.data.name} userId={me.id} coat={me.cat_coat} pending={pending} />
      <div className="cc-join-copy"><h1>{pending ? 'Waiting for owner approval' : `Welcome to ${join.data.name}`}</h1>
        {pending && <p role="status">Your request to join {join.data.name} is saved. The owner can approve it from their cache page. We'll let you know when you're in.</p>}
      </div>
      <Link to={pending ? '/' : `/caches/${join.data.cache_id}`} className="cc-profile-secondary cc-auth-bottom">{pending ? 'Go home' : 'Open cache'}</Link>
    </AuthScreen>
  }
  const scene = <InviteBox userId={me.id} coat={me.cat_coat} />
  return <AuthScreen className="cc-join" illustration={<div className="cc-join-illustration">{scene}</div>}>
    <AuthBrand className="cc-auth-brand-desktop" />
    <div className="cc-join-mobile-scene">{scene}</div>
    <div className="cc-join-copy"><h1>There's room in the box for you.</h1><p>Hi, {me.display_name}. If this cache requires approval, its owner will review your request.</p></div>
    {join.isError && <p role="alert" className="cc-form-error">{errorMessage(join.error)}</p>}
    <div className="cc-join-actions cc-auth-bottom">
      <button type="button" disabled={join.isPending} onClick={() => join.mutate()} className="cc-profile-primary">{join.isPending ? 'Joining…' : 'Ask to join'}</button>
      <Link to="/" onClick={() => clearJoinToken(token)} className="cc-join-cancel"><span className="cc-join-cancel-short">Not now</span><span className="cc-join-cancel-long">Not now, cancel this invite</span></Link>
    </div>
    <p className="cc-join-desktop-note">Not now cancels this invite on this browser. You can open the link again later.</p>
  </AuthScreen>
}
