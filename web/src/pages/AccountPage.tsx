import { useRef, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import { refreshProfileViews } from '../lib/profile'
import { Stamp } from '../components/Stamp'
import { OnboardingPage } from './OnboardingPage'
import { PushControls } from './PushControls'
import { ProfilePhotoControls } from './ProfilePhotoControls'
import { CoatControls } from './CoatControls'
import { ContactControls } from './ContactControls'
import { SupportCard } from '../components/Support'
import { PeekControls } from './PeekControls'

export function AccountPage() {
  const { me, signOut } = useAuth()
  const client = useQueryClient()
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(me?.display_name ?? '')
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const editNameButton = useRef<HTMLButtonElement>(null)
  const saveName = useMutation({
    mutationFn: () => apiFetch('/api/me', { method: 'PATCH', body: { display_name: name } }),
    onSuccess: async () => {
      await refreshProfileViews(client)
      setEditingName(false)
      editNameButton.current?.focus()
    },
  })
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />

  function submitName(event: FormEvent) {
    event.preventDefault()
    saveName.mutate()
  }
  async function logout() {
    setSigningOut(true)
    setSignOutError('')
    try { await signOut() }
    catch (error) { setSignOutError(errorMessage(error)) }
    finally { setSigningOut(false) }
  }

  return <main className="cc-account-page">
    <div className="cc-account-layout">
      <section className="cc-account-profile" aria-labelledby="account-heading">
        <h1 id="account-heading">Account</h1>
        <div className="cc-profile-label">
          <div className="cc-profile-label-header">
            <span>FROM</span><strong>{me.display_name}</strong><span className="cc-profile-label-helper">What neighbors see</span>
          </div>
          <div className="cc-profile-label-body">
            <ProfilePhotoControls key={me.id} />
            <CoatControls className="cc-account-coats" />
            <div className="cc-profile-field">
              <div><strong>Display name</strong><p>{me.display_name}</p></div>
              <button ref={editNameButton} type="button" className="cc-text-action" onClick={() => {
                setName(me.display_name!)
                saveName.reset()
                setEditingName(true)
              }} aria-expanded={editingName}>Edit<span className="sr-only"> display name</span></button>
            </div>
            {editingName && <form onSubmit={submitName} className="cc-account-name-editor">
              <label htmlFor="account-name">Display name</label>
              <input autoFocus id="account-name" className="cc-profile-input" required maxLength={60} value={name} onChange={event => setName(event.target.value)} />
              {saveName.isError && <p role="alert" className="cc-form-error">{errorMessage(saveName.error)}</p>}
              <div className="cc-inline-actions">
                <button className="cc-profile-primary" disabled={saveName.isPending || !name.trim()}>{saveName.isPending ? 'Saving…' : 'Save name'}</button>
                <button type="button" className="cc-profile-secondary" disabled={saveName.isPending} onClick={() => { setEditingName(false); editNameButton.current?.focus() }}>Cancel</button>
              </div>
            </form>}
            <div className="cc-profile-field cc-account-email"><div><strong>Email</strong><p>{me.email}</p></div><Stamp tone="warn">PRIVATE</Stamp></div>
          </div>
        </div>
        {saveName.isSuccess && <p role="status" className="cc-form-hint">Profile saved.</p>}
      </section>
      <div className="cc-account-settings">
        <ContactControls key={me.id} />
        <div className="cc-account-options">
          <PushControls userId={me.id} />
          <PeekControls />
          <section className="cc-account-session" aria-label="Session">
            <p>Signed in on this browser</p>
            <button type="button" disabled={signingOut} className="cc-profile-secondary" onClick={() => void logout()}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
            <span className="cc-session-mobile-hint">This browser</span>
            {signOutError && <p role="alert" className="cc-form-error">{signOutError}</p>}
          </section>
          <SupportCard />
        </div>
      </div>
    </div>
  </main>
}
