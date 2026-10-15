import { useRef, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import { destinationAfterLogin } from '../lib/pendingJoin'
import { sendSignInEmail } from '../lib/magicLinks'
import { AuthScreen, BrandMark, MailIcon } from '../components/AuthScreen'
import { CodeInput } from '../components/CodeInput'
import { PixelHorizon } from '../components/PixelArt'
import { landingCopy } from '../lib/landingCopy'

export function LoginForm({ inviteToken, inviteHint = false }: { inviteToken?: string; inviteHint?: boolean }) {
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

  return <AuthScreen>
    {!sent && <header className="hidden lg:block"><h1 className="lg:text-2xl lg:font-bold">{inviteToken ? "You're invited" : 'Sign in'}</h1><p className="lg:mt-2 lg:text-slate-600">{inviteToken ? 'Someone shared a Communal Cache with you. Sign in to join.' : "We'll email you a link. No password."}</p></header>}
    {!sent ? <header className="lg:hidden">
      <BrandMark />
      <h1 className="cc-auth-heading">{inviteToken ? "You're invited" : <>Share more,<br />buy less.</>}</h1>
      <p className="mt-2 text-slate-600">{inviteToken ? 'Someone shared a Communal Cache with you. Sign in to join.' : 'Borrow and lend with your neighbors on Communal Cache.'}</p>
      <PixelHorizon kind="boxes" entries={['Share','Borrow','Lend'].map(name=>({id:name,name}))} />
    </header> : <header className="mt-10 text-center lg:mt-0">
      <div aria-hidden="true" className="mx-auto flex size-16 items-center justify-center rounded-full bg-blue-100 text-blue-800">{sent === 'link' ? <MailIcon /> : <span className="text-[22px] font-bold">123</span>}</div>
      <h1 className="cc-auth-heading">{sent === 'link' ? 'Check your email' : 'Enter your code'}</h1>
      <p role="status" className="mt-2 text-slate-600">{sent === 'link' ? 'We sent a sign-in link to' : 'Sent to'}<br /><strong className="break-all text-slate-900">{email.trim()}</strong></p>
    </header>}
    {inviteHint && !inviteToken && <aside className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm" role="note">{landingCopy.inviteNote}</aside>}
    {inviteToken && <aside className="mt-6 flex items-center gap-3 rounded-[14px] border border-indigo-200 bg-white p-3.5" aria-label="Saved invite">
      <div aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-800"><MailIcon /></div>
      <div className="text-sm"><p className="font-semibold">Invite saved in this tab</p><p className="text-slate-600">Open the link in this same tab to keep it, or use a code here.</p></div>
    </aside>}
    <form className={inviteToken && !sent ? 'mt-4 lg:mt-6' : 'mt-8 lg:mt-6'} onSubmit={onSubmit}>
      <div className="cc-auth-card lg:border-0 lg:p-0 lg:shadow-none">
        <div className={sent ? 'sr-only' : undefined} aria-hidden={sent ? true : undefined}>
          <label htmlFor="email" className="block text-sm font-medium">Email</label>
          <input ref={emailInput} id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required readOnly={!!sent} disabled={pending} tabIndex={sent ? -1 : undefined}
            value={email} onChange={event => setEmail(event.target.value)} className="cc-auth-input" />
        </div>
        {sent === 'link' && <div><p>Open the email and tap <b>Continue</b> on the page it opens. The link works for 5 minutes.</p><p className="mt-2 text-xs text-slate-600">Use the newest link if you requested another.</p></div>}
        {sent === 'code' && <CodeInput value={code} onChange={setCode} />}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={pending} className={`${sent === 'link' ? 'cc-auth-secondary' : 'cc-auth-primary'} mt-4`}>
          {pending ? 'Please wait…' : sent === 'code' ? 'Sign in' : sent === 'link' ? 'Resend link' : 'Email me a sign-in link'}
        </button>
        <div className={sent === 'code' ? 'mt-2 flex flex-wrap justify-between gap-x-2' : 'mt-2'}>
          <button type="button" disabled={pending} onClick={() => void sendEmail('code')} className={`cc-auth-text ${sent === 'code' ? '' : 'w-full'}`}>{sent === 'code' ? 'Resend code' : 'Use a 6-digit code instead'}</button>
          {sent === 'code' && <button type="button" disabled={pending} onClick={() => void sendEmail('link')} className="cc-auth-text">Email a link instead</button>}
        </div>
      </div>
      {sent && <button type="button" disabled={pending} onClick={() => { setSent(null); setCode(''); setError(null); emailInput.current?.focus() }} className="cc-auth-text mt-4 w-full text-slate-600">Wrong email? Change it</button>}
    </form>
    {!sent && !inviteToken && <p className="mt-6 text-center text-[13px] leading-[18px] text-slate-600">Your email stays private. Neighbors only see the name you choose.</p>}
  </AuthScreen>
}

export function LoginPage() {
  const { me } = useAuth()
  const [search] = useSearchParams()
  return me ? <Navigate to={destinationAfterLogin()} replace /> : <LoginForm inviteHint={search.get('invite') === '1'} />
}
