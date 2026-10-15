import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage, type Me } from '../lib/api'
import { subscriptionForAccount } from '../lib/push'
import { readMagicLink, verifyMagicLink } from '../lib/magicLinks'
import { destinationAfterLogin, peekJoinToken } from '../lib/pendingJoin'

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
      const callback = new URL(result.callback_url, location.origin)
      const destination = peekJoinToken() ? destinationAfterLogin() : callback.origin === location.origin ? callback.pathname + callback.search + callback.hash : '/'
      navigate(destination, { replace: true })
    } catch (error) { setError(errorMessage(error)) }
    finally { setPending(false) }
  }
  return <main className="mx-auto max-w-md px-4 py-12">
    <h1 className="text-2xl font-semibold tracking-tight">Continue to Communal Cache</h1>
    <p className="mt-2 text-slate-600">Press Continue to sign in. Opening this page does not use your link. Links expire after 5 minutes and can be used once.</p>
    {!link && <p role="alert" className="mt-4 text-red-700">This sign-in link is missing or invalid. Request a new link or use an email code.</p>}
    {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
    {link && <button type="button" disabled={pending || attempted} onClick={() => void proceed()} className="mt-6 rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60">{pending ? 'Signing in…' : 'Continue'}</button>}
    <Link to="/login" className="mt-6 block underline">Request a new link or email code</Link>
    <p className="mt-4 text-sm text-slate-600">You can sign in from another browser. A saved cache invite stays in its original tab; reopen that invite here if needed.</p>
  </main>
}
