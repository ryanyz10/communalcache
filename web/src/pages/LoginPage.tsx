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
import { LegalLinks } from '../components/LegalLinks'
import { GoogleSignInButton } from '../components/GoogleSignInButton'
import { googleSignInError, googleSignInUrl } from '../lib/googleSignIn'

export function LoginForm({ inviteToken, inviteHint = false }: { inviteToken?: string; inviteHint?: boolean }) {
  const { refresh } = useAuth()
  const [search] = useSearchParams()
  const emailInput = useRef<HTMLInputElement>(null)
  const botCheck = useRef<TurnstileHandle>(null)
  const [botToken, setBotToken] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [sentMode, setSentMode] = useState<'link' | 'code' | null>(null)
  const [error, setError] = useState<string | null>(search.has('error') ? googleSignInError : null)

  async function continueWithGoogle() {
    setPending(true)
    setError(null)
    try {
      window.location.assign(await googleSignInUrl(inviteToken))
    } catch {
      setError(googleSignInError)
      setPending(false)
    }
  }

  async function sendEmail(mode: 'link' | 'code') {
    if (!emailInput.current?.reportValidity()) return
    setPending(true)
    setError(null)
    try {
      await sendSignInEmail(email, mode, inviteToken, botToken)
      setSentMode(mode)
      setCode('')
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setPending(false)
      botCheck.current?.reset()
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sentMode !== 'code') {
      await sendEmail('link')
      return
    }
    setPending(true)
    setError(null)
    try {
      await apiFetch('/api/auth/sign-in/email-otp', { body: { email: email.trim(), otp: code } })
      await refresh()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  let heading: string
  if (sentMode === 'link') heading = 'Check your email'
  else if (sentMode === 'code') heading = 'Enter your code'
  else if (inviteToken) heading = "You're invited"
  else heading = 'Sign in'
  let submitLabel: string
  if (pending) submitLabel = 'Please wait…'
  else if (sentMode === 'code') submitLabel = 'Sign in'
  else if (sentMode === 'link') submitLabel = 'Resend link'
  else submitLabel = 'Email me a sign-in link'

  return <AuthScreen illustration={<SignInBox />} className={`cc-signin${sentMode ? ` cc-signin-${sentMode}` : ''}`}>
    <AuthBrand className="cc-auth-brand-desktop" />
    {!sentMode && <div className="cc-signin-mobile"><AuthBrand /><SignInBox /></div>}
    {sentMode === 'link' && <div className="cc-email-box">
      <span className="cc-email-handle" aria-hidden="true" />
      <div className="cc-email-label" role="status"><span>DELIVER TO</span><strong>{email.trim()}</strong></div>
    </div>}
    <header className="cc-signin-copy">
      <h1>{heading}</h1>
      {!sentMode && <>
        <p className="cc-signin-desktop-subtitle">{inviteToken ? 'Someone shared a Communal Cache with you. Sign in to join.' : "We'll email you a link. No password."}</p>
        <p className="cc-signin-mobile-subtitle">{inviteToken ? 'Someone shared a Communal Cache with you. Sign in to join.' : "Borrow and lend with your neighbors. We'll email you a link. No password."}</p>
      </>}
      {sentMode === 'link' && <>
        <p>Open the email and tap <b>Continue</b> on the page it opens. The link works for 5 minutes.</p>
        <p className="cc-form-hint">Use the newest link if you requested another.</p>
      </>}
      {sentMode === 'code' && <p role="status">Sent to<br /><strong>{email.trim()}</strong></p>}
    </header>
    {inviteHint && !inviteToken && <aside className="cc-saved-invite" role="note">{landingCopy.inviteNote}</aside>}
    {inviteToken && <aside className="cc-saved-invite" aria-label="Saved invite">
      <strong>Invite saved on this browser</strong><p>After signing in, you’ll come back here. A saved invite lasts up to 1 hour.</p>
    </aside>}
    <form className="cc-login-form" onSubmit={submit}>
      {!sentMode && <GoogleSignInButton disabled={pending} onClick={() => void continueWithGoogle()} />}
      <div className={sentMode ? 'sr-only' : 'cc-email-field'} aria-hidden={sentMode ? true : undefined}>
        <label htmlFor="email">Email</label>
        <input
          ref={emailInput} id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required
          readOnly={!!sentMode} disabled={pending} tabIndex={sentMode ? -1 : undefined} value={email}
          onChange={event => setEmail(event.target.value)} className="cc-profile-input"
        />
      </div>
      {sentMode === 'code' && <CodeInput value={code} onChange={setCode} />}
      <div className="cc-signin-bot"><Turnstile ref={botCheck} action="signin" onToken={setBotToken} /></div>
      {error && <p role="alert" className="cc-form-error">{error}</p>}
      <button type="submit" disabled={pending || (sentMode !== 'code' && !botToken)} className={sentMode === 'link' ? 'cc-profile-secondary' : 'cc-profile-primary'}>{submitLabel}</button>
      <div className="cc-login-fallbacks">
        <button type="button" disabled={pending || !botToken} onClick={() => void sendEmail('code')} className="cc-text-action">{sentMode === 'code' ? 'Resend code' : 'Use a 6-digit code instead'}</button>
        {sentMode === 'code' && <button type="button" disabled={pending || !botToken} onClick={() => void sendEmail('link')} className="cc-text-action">Email a link instead</button>}
      </div>
      {sentMode && <button type="button" disabled={pending} onClick={() => {
        setSentMode(null)
        setCode('')
        setError(null)
        botCheck.current?.reset()
        emailInput.current?.focus()
      }} className="cc-login-wrong-email">Wrong email? Change it</button>}
    </form>
    {!sentMode && !inviteToken && <p className="cc-signin-privacy">Your email stays private. Neighbors only see the name you choose.</p>}
    <LegalLinks />
  </AuthScreen>
}

export function LoginPage() {
  const { me } = useAuth()
  const [search] = useSearchParams()
  return me ? <Navigate to={destinationAfterLogin()} replace /> : <LoginForm inviteHint={search.get('invite') === '1'} />
}
