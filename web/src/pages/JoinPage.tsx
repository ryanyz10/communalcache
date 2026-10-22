import { Link, useParams } from 'react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { joinFromToken, invitePreviewQuery, joiningKeys } from '../lib/joining'
import { errorMessage } from '../lib/api'
import { useAuth } from '../auth/AuthProvider'
import { cacheKeys } from '../lib/caches'
import { clearJoinToken, stashJoinToken, validJoinToken } from '../lib/pendingJoin'
import { LoginForm } from './LoginPage'
import { OnboardingPage } from './OnboardingPage'
import { AuthBrand, AuthScreen } from '../components/AuthScreen'
import { InviteBox } from '../components/InviteBox'
import { LoadingStatus, Shimmer } from '../components/Skeleton'
import { useToast } from '../components/Toast'
import { transientActionFailure } from '../lib/feedback'

export function JoinPage() {
  const { token = '' } = useParams()
  const { me } = useAuth()
  const [storageError, setStorageError] = useState(false)
  const client = useQueryClient()
  const { showToast } = useToast()
  const joinCache = useMutation({
    mutationFn: joinFromToken,
    retry: false,
    onSuccess: () => { void client.invalidateQueries({ queryKey: cacheKeys.list() }) },
    onError: (error, failedToken) => {
      if (transientActionFailure(error)) showToast(errorMessage(error), 'error')
      return client.invalidateQueries({ queryKey: joiningKeys.preview(me?.id, failedToken) })
    },
  })
  const validToken = validJoinToken(token)
  const joinedThisInvite = joinCache.isSuccess && joinCache.variables === token
  const previewQuery = useQuery({
    ...invitePreviewQuery(me?.id, token),
    enabled: validToken && !!me?.display_name && !storageError && !joinedThisInvite,
    retry: false, staleTime: 0, gcTime: 0,
  })
  useEffect(() => {
    if (!validToken) return
    try { stashJoinToken(token) }
    catch { setStorageError(true) }
  }, [token, validToken])

  if (!validToken) return <AuthScreen className="cc-auth-recovery"><h1>Invalid invite link</h1><Link to="/" className="cc-profile-secondary">Go home</Link></AuthScreen>
  if (storageError) return <AuthScreen className="cc-auth-recovery"><p role="alert">Could not save this invite. Enable storage for this site and try again.</p></AuthScreen>
  if (!me) return <LoginForm inviteToken={token} />
  if (!me.display_name) return <OnboardingPage />
  if (joinedThisInvite) {
    const pendingApproval = joinCache.data.status === 'pending'
    return <AuthScreen className="cc-join-result">
      <InviteBox name={joinCache.data.name} userId={me.id} coat={me.cat_coat} pending={pendingApproval} />
      <div className="cc-join-copy">
        <h1>{pendingApproval ? 'Waiting for owner approval' : `Welcome to ${joinCache.data.name}`}</h1>
        {pendingApproval && <p role="status">Your request to join {joinCache.data.name} is saved. The owner can approve it from their cache page. We'll let you know when you're in.</p>}
      </div>
      <Link to={pendingApproval ? '/' : `/caches/${joinCache.data.cache_id}`} className="cc-profile-secondary cc-auth-bottom">{pendingApproval ? 'Go home' : 'Open cache'}</Link>
    </AuthScreen>
  }

  const preview = previewQuery.isSuccess ? previewQuery.data : undefined
  const scene = <InviteBox userId={me.id} coat={me.cat_coat} preview={preview} loading={previewQuery.isPending} />
  let eyebrow: ReactNode
  if (previewQuery.isPending) eyebrow = <p className="cc-invite-eyebrow"><Shimmer width={200} height={14} /></p>
  else if (preview) eyebrow = <p className="cc-invite-eyebrow">An invite to {preview.name}</p>

  return <AuthScreen className="cc-join" illustration={<div className="cc-join-illustration">{eyebrow}{scene}</div>}>
    <AuthBrand className="cc-auth-brand-desktop" />
    <div className="cc-join-mobile-scene">{eyebrow}{scene}</div>
    <div className="cc-join-copy">
      <h1>There's room in the box for you.</h1>
      <p>Hi, {me.display_name}. If this cache requires approval, its owner will review your request.</p>
      {previewQuery.isPending && <LoadingStatus label="Loading invitation…" />}
      {previewQuery.isError && <div>
        <p role="alert" className="cc-form-error">{errorMessage(previewQuery.error)}</p>
        <button type="button" className="cc-text-action" disabled={previewQuery.isFetching} onClick={() => void previewQuery.refetch()}>Try invitation again</button>
      </div>}
    </div>
    {joinCache.isError && !transientActionFailure(joinCache.error) && joinCache.variables === token && <p role="alert" className="cc-form-error">{errorMessage(joinCache.error)}</p>}
    <div className="cc-join-actions cc-auth-bottom">
      <button type="button" disabled={joinCache.isPending || !preview || previewQuery.isFetching} onClick={() => joinCache.mutate(token)} className="cc-profile-primary">{joinCache.isPending ? 'Joining…' : 'Ask to join'}</button>
      <Link to="/" onClick={() => clearJoinToken(token)} className="cc-join-cancel"><span className="cc-join-cancel-short">Not now</span><span className="cc-join-cancel-long">Not now, cancel this invite</span></Link>
    </div>
    <p className="cc-join-desktop-note">Not now cancels this invite on this browser. You can open the link again later.</p>
  </AuthScreen>
}
