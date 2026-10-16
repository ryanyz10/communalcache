import { useRef, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import { destinationAfterLogin } from '../lib/pendingJoin'
import { sendSignInEmail } from '../lib/magicLinks'
import { AuthScreen, AuthBrand, SignInBox } from '../components/AuthScreen'
import { CodeInput } from '../components/CodeInput'
import { landingCopy } from '../lib/landingCopy'
import { Turnstile, type TurnstileHandle } from '../components/Turnstile'

export function LoginForm({ inviteToken, inviteHint = false }: { inviteToken?: string; inviteHint?: boolean }) {
  const { refresh } = useAuth()
  const emailInput = useRef<HTMLInputElement>(null), botCheck = useRef<TurnstileHandle>(null)
  const [botToken, setBotToken] = useState(''), [email, setEmail] = useState(''), [code, setCode] = useState('')
  const [pending, setPending] = useState(false), [sent, setSent] = useState<'link' | 'code' | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function sendEmail(mode: 'link' | 'code') {
    if (!emailInput.current?.reportValidity()) return
    setPending(true); setError(null)
    try { await sendSignInEmail(email,mode,inviteToken,botToken); setSent(mode); setCode('') }
    catch (error) { setError(errorMessage(error)) }
    finally { setPending(false); botCheck.current?.reset() }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sent !== 'code') { await sendEmail('link'); return }
    setPending(true); setError(null)
    try { await apiFetch('/api/auth/sign-in/email-otp',{body:{email:email.trim(),otp:code}}); await refresh() }
    catch (error) { setError(errorMessage(error)) }
    finally { setPending(false) }
  }
  return <AuthScreen illustration={<SignInBox />} className={`cc-signin${sent ? ` cc-signin-${sent}` : ''}`}>
    <AuthBrand className="cc-auth-brand-desktop" />
    {!sent && <div className="cc-signin-mobile"><AuthBrand /><SignInBox /></div>}
    {sent === 'link' && <div className="cc-email-box"><span className="cc-email-handle" aria-hidden="true" /><div className="cc-email-label" role="status"><span>DELIVER TO</span><strong>{email.trim()}</strong></div></div>}
    <header className="cc-signin-copy">
      <h1>{sent === 'link' ? 'Check your email' : sent === 'code' ? 'Enter your code' : inviteToken ? "You're invited" : 'Sign in'}</h1>
      {!sent && <>
        <p className="cc-signin-desktop-subtitle">{inviteToken ? 'Someone shared a Communal Cache with you. Sign in to join.' : "We'll email you a link. No password."}</p>
        <p className="cc-signin-mobile-subtitle">{inviteToken ? 'Someone shared a Communal Cache with you. Sign in to join.' : "Borrow and lend with your neighbors. We'll email you a link. No password."}</p>
      </>}
      {sent === 'link' && <><p>Open the email and tap <b>Continue</b> on the page it opens. The link works for 5 minutes.</p><p className="cc-form-hint">Use the newest link if you requested another.</p></>}
      {sent === 'code' && <p role="status">Sent to<br /><strong>{email.trim()}</strong></p>}
    </header>
    {inviteHint && !inviteToken && <aside className="cc-saved-invite" role="note">{landingCopy.inviteNote}</aside>}
    {inviteToken && <aside className="cc-saved-invite" aria-label="Saved invite"><strong>Invite saved on this browser</strong><p>Your sign-in link will bring you back here. A saved invite lasts up to 1 hour.</p></aside>}
    <form className="cc-login-form" onSubmit={submit}>
      <div className={sent ? 'sr-only' : 'cc-email-field'} aria-hidden={sent ? true : undefined}>
        <label htmlFor="email">Email</label>
        <input ref={emailInput} id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required readOnly={!!sent} disabled={pending} tabIndex={sent ? -1 : undefined} value={email} onChange={event => setEmail(event.target.value)} className="cc-profile-input" />
      </div>
      {sent === 'code' && <CodeInput value={code} onChange={setCode} />}
      <div className="cc-signin-bot"><Turnstile ref={botCheck} action="signin" onToken={setBotToken} /></div>
      {error && <p role="alert" className="cc-form-error">{error}</p>}
      <button type="submit" disabled={pending || (sent !== 'code' && !botToken)} className={sent === 'link' ? 'cc-profile-secondary' : 'cc-profile-primary'}>{pending ? 'Please wait…' : sent === 'code' ? 'Sign in' : sent === 'link' ? 'Resend link' : 'Email me a sign-in link'}</button>
      <div className="cc-login-fallbacks">
        <button type="button" disabled={pending || !botToken} onClick={() => void sendEmail('code')} className="cc-text-action">{sent === 'code' ? 'Resend code' : 'Use a 6-digit code instead'}</button>
        {sent === 'code' && <button type="button" disabled={pending || !botToken} onClick={() => void sendEmail('link')} className="cc-text-action">Email a link instead</button>}
      </div>
      {sent && <button type="button" disabled={pending} onClick={() => { setSent(null); setCode(''); setError(null); botCheck.current?.reset(); emailInput.current?.focus() }} className="cc-login-wrong-email">Wrong email? Change it</button>}
    </form>
    {!sent && !inviteToken && <p className="cc-signin-privacy">Your email stays private. Neighbors only see the name you choose.</p>}
  </AuthScreen>
}

export function LoginPage() {
  const { me } = useAuth(), [search] = useSearchParams()
  return me ? <Navigate to={destinationAfterLogin()} replace /> : <LoginForm inviteHint={search.get('invite') === '1'} />
}
