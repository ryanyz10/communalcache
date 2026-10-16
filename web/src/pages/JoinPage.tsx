import { Link, useParams } from 'react-router'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { joinFromToken, previewFromToken } from '../lib/joining'
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
  const join = useMutation({
    mutationFn: joinFromToken,
    retry: false,
    onSuccess: () => { void client.invalidateQueries({queryKey:['caches']}) },
    onError: (_error,failedToken) => client.invalidateQueries({queryKey:['invite-preview',me?.id,failedToken]}),
  })
  const valid = validJoinToken(token), joined = join.isSuccess && join.variables === token
  const preview = useQuery({
    queryKey: ['invite-preview',me?.id,token], queryFn: () => previewFromToken(token),
    enabled: valid && !!me?.display_name && !storageError && !joined,
    retry: false, staleTime: 0, gcTime: 0,
  })
  useEffect(() => {
    if (!valid) return
    try { stashJoinToken(token) } catch { setStorageError(true) }
  }, [token, valid])
  if (!valid) return <AuthScreen className="cc-auth-recovery"><h1>Invalid invite link</h1><Link to="/" className="cc-profile-secondary">Go home</Link></AuthScreen>
  if (storageError) return <AuthScreen className="cc-auth-recovery"><p role="alert">Could not save this invite. Enable storage for this site and try again.</p></AuthScreen>
  if (!me) return <LoginForm inviteToken={token} />
  if (!me.display_name) return <OnboardingPage />
  if (joined) {
    const pending = join.data.status === 'pending'
    return <AuthScreen className="cc-join-result">
      <InviteBox name={join.data.name} userId={me.id} coat={me.cat_coat} pending={pending} />
      <div className="cc-join-copy"><h1>{pending ? 'Waiting for owner approval' : `Welcome to ${join.data.name}`}</h1>
        {pending && <p role="status">Your request to join {join.data.name} is saved. The owner can approve it from their cache page. We'll let you know when you're in.</p>}
      </div>
      <Link to={pending ? '/' : `/caches/${join.data.cache_id}`} className="cc-profile-secondary cc-auth-bottom">{pending ? 'Go home' : 'Open cache'}</Link>
    </AuthScreen>
  }
  const details = preview.isSuccess ? preview.data : undefined
  const scene = <InviteBox userId={me.id} coat={me.cat_coat} preview={details} />
  const eyebrow = details && <p className="cc-invite-eyebrow">An invite to {details.name}</p>
  return <AuthScreen className="cc-join" illustration={<div className="cc-join-illustration">{eyebrow}{scene}</div>}>
    <AuthBrand className="cc-auth-brand-desktop" />
    <div className="cc-join-mobile-scene">{eyebrow}{scene}</div>
    <div className="cc-join-copy"><h1>There's room in the box for you.</h1><p>Hi, {me.display_name}. If this cache requires approval, its owner will review your request.</p>
      {preview.isPending && <p role="status">Loading invitation…</p>}
      {preview.isError && <div><p role="alert" className="cc-form-error">{errorMessage(preview.error)}</p><button type="button" className="cc-text-action" disabled={preview.isFetching} onClick={()=>void preview.refetch()}>Try invitation again</button></div>}
    </div>
    {join.isError && join.variables === token && <p role="alert" className="cc-form-error">{errorMessage(join.error)}</p>}
    <div className="cc-join-actions cc-auth-bottom">
      <button type="button" disabled={join.isPending || !details || preview.isFetching} onClick={() => join.mutate(token)} className="cc-profile-primary">{join.isPending ? 'Joining…' : 'Ask to join'}</button>
      <Link to="/" onClick={() => clearJoinToken(token)} className="cc-join-cancel"><span className="cc-join-cancel-short">Not now</span><span className="cc-join-cancel-long">Not now, cancel this invite</span></Link>
    </div>
    <p className="cc-join-desktop-note">Not now cancels this invite on this browser. You can open the link again later.</p>
  </AuthScreen>
}
