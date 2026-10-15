import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage, type Me } from '../lib/api'
import { subscriptionForAccount } from '../lib/push'
import { magicLinkDestination, readMagicLink, verifyMagicLink } from '../lib/magicLinks'
import { AuthScreen, BrandMark } from '../components/AuthScreen'

export function MagicLinkPage() {
  const [link] = useState(() => readMagicLink(location.hash))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [attempted, setAttempted] = useState(false)
  const { refresh } = useAuth()
  const client = useQueryClient()
  const navigate = useNavigate()
  useEffect(() => {
    // Keep the bearer token only in this page's memory, not browser history.
    history.replaceState(history.state, '', location.pathname + location.search)
  }, [])
  async function proceed() {
    if (!link || pending) return
    setPending(true); setError(''); setAttempted(true)
    try {
      const result = await verifyMagicLink(link)
      // A link may sign this browser into a different account; discard its old private views.
      client.removeQueries({ predicate: query => query.queryKey[0] !== 'me' })
      await refresh()
      const signedIn = client.getQueryData<Me | null>(['me'])
      if (signedIn && 'serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/')
        if (registration) await subscriptionForAccount(registration, signedIn.id)
      }
      navigate(magicLinkDestination(result.callback_url,location.origin), { replace: true })
    } catch (error) { setError(errorMessage(error)) }
    finally { setPending(false) }
  }
  return <AuthScreen>
    <header className="mt-14 text-center lg:mt-0">
      <div className="flex justify-center lg:hidden"><BrandMark /></div>
      <h1 className="cc-auth-heading lg:mt-0">Almost there</h1>
      <p className="mt-2 text-slate-600">Tap Continue to finish signing in.</p>
    </header>
    {!link && <p role="alert" className="mt-4 text-red-700">This sign-in link is missing or invalid. Request a new link or use an email code.</p>}
    {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
    {link && <button type="button" disabled={pending || attempted} onClick={() => void proceed()} className="cc-auth-primary mt-8">{pending ? 'Signing in…' : 'Continue'}</button>}
    <p className="mt-4 text-center text-[13px] leading-[18px] text-slate-600">Opening this page does not use your link. Links work once and expire after 5 minutes.</p>
    <div className="min-h-8 flex-1 lg:flex-none" />
    <Link to="/login" className="cc-auth-text">Link not working? Get a new one</Link>
    <p className="mt-2 text-center text-[13px] leading-[18px] text-slate-600">You can also request an email code. Invites follow your sign-in link and are saved on this browser for up to an hour. In another browser, reopen or paste the invite.</p>
  </AuthScreen>
}
