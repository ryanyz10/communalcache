import { useRef, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import { destinationAfterLogin } from '../lib/pendingJoin'
import { sendSignInEmail } from '../lib/magicLinks'

export function LoginForm({ inviteToken }: { inviteToken?: string }) {
  const { refresh } = useAuth()
  const emailInput = useRef<HTMLInputElement>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState<'link' | 'code' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function sendEmail(mode: 'link' | 'code') {
    if (!emailInput.current?.reportValidity()) return
    setPending(true)
    setError(null)
    try {
      await sendSignInEmail(email, mode, inviteToken)
      setSent(mode)
      setCode('')
    } catch (error) { setError(errorMessage(error)) }
    finally { setPending(false) }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (sent !== 'code') { await sendEmail('link'); return }
    setPending(true)
    setError(null)
    try {
      await apiFetch('/api/auth/sign-in/email-otp', { body: { email: email.trim(), otp: code } })
      await refresh()
    } catch (error) { setError(errorMessage(error)) }
    finally { setPending(false) }
  }

  return <main className="mx-auto max-w-md px-4 py-12">
    <h1 className="text-2xl font-semibold tracking-tight">Communal Cache</h1>
    <p className="mt-2 text-slate-600">Sign in with an email link, or use a six-digit code instead. Your email is private; neighbors see only your chosen name.</p>
    {inviteToken && <p className="mt-3 text-slate-600">Your invite stays in this tab while you sign in. Open the link in this tab to keep it, or use a code here.</p>}
    <form className="mt-8 space-y-4" onSubmit={onSubmit}>
      <div>
        <label htmlFor="email" className="block text-sm font-medium">Email</label>
        <input ref={emailInput} id="email" name="email" type="email" autoComplete="email" required readOnly={!!sent} disabled={pending}
          value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
      </div>
      {sent === 'link' && <p role="status" className="text-sm text-emerald-700">Check your email for a sign-in link, then press Continue on the page it opens. It expires in 5 minutes; use the newest link if you requested another.</p>}
      {sent === 'code' && <>
        <p role="status" className="text-sm text-emerald-700">Check your email. Codes expire in 5 minutes; use the most recent code you requested, even if an older email arrives later.</p>
        <div>
          <label htmlFor="code" className="block text-sm font-medium">Six-digit code</label>
          <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required
            value={code} onChange={event => setCode(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </div>
      </>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={pending} className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60">
        {pending ? 'Please wait…' : sent === 'code' ? 'Sign in' : sent === 'link' ? 'Send a new link' : 'Email me a sign-in link'}
      </button>
      <div className="flex flex-wrap gap-4">
        <button type="button" disabled={pending} onClick={() => void sendEmail('code')} className="underline">{sent === 'code' ? 'Send a new code' : 'Email me a code instead'}</button>
        {sent === 'code' && <button type="button" disabled={pending} onClick={() => void sendEmail('link')} className="underline">Email me a sign-in link instead</button>}
        {sent && <button type="button" disabled={pending} onClick={() => { setSent(null); setCode(''); setError(null); emailInput.current?.focus() }} className="underline">Change email</button>}
      </div>
    </form>
  </main>
}

export function LoginPage() {
  const { me } = useAuth()
  return me ? <Navigate to={destinationAfterLogin()} replace /> : <LoginForm />
}
