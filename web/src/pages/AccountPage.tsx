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

export function AccountPage() {
  const { me, signOut } = useAuth(), client = useQueryClient()
  const [editing, setEditing] = useState(false), [name, setName] = useState(me?.display_name ?? '')
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  const edit = useRef<HTMLButtonElement>(null)
  const save = useMutation({
    mutationFn: () => apiFetch('/api/me',{method:'PATCH',body:{display_name:name}}),
    onSuccess: async () => { await refreshProfileViews(client); setEditing(false); edit.current?.focus() },
  })
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  function submit(event: FormEvent) { event.preventDefault(); save.mutate() }
  async function logout() {
    setPending(true); setError('')
    try { await signOut() } catch (error) { setError(errorMessage(error)) } finally { setPending(false) }
  }
  return <main className="cc-account-page">
    <div className="cc-account-layout">
      <section className="cc-account-profile" aria-labelledby="account-heading">
        <h1 id="account-heading">Account</h1>
        <div className="cc-profile-label">
          <div className="cc-profile-label-header"><span>FROM</span><strong>{me.display_name}</strong><span className="cc-profile-label-helper">What neighbors see</span></div>
          <div className="cc-profile-label-body">
            <ProfilePhotoControls key={me.id} />
            <CoatControls className="cc-account-coats" />
            <div className="cc-profile-field"><div><strong>Display name</strong><p>{me.display_name}</p></div><button ref={edit} type="button" className="cc-text-action" onClick={() => { setName(me.display_name!); save.reset(); setEditing(true) }} aria-expanded={editing}>Edit<span className="sr-only"> display name</span></button></div>
            {editing && <form onSubmit={submit} className="cc-account-name-editor">
              <label htmlFor="account-name">Display name</label><input autoFocus id="account-name" className="cc-profile-input" required maxLength={60} value={name} onChange={event => setName(event.target.value)} />
              {save.isError && <p role="alert" className="cc-form-error">{errorMessage(save.error)}</p>}
              <div className="cc-inline-actions"><button className="cc-profile-primary" disabled={save.isPending || !name.trim()}>{save.isPending ? 'Saving…' : 'Save name'}</button><button type="button" className="cc-profile-secondary" disabled={save.isPending} onClick={() => { setEditing(false); edit.current?.focus() }}>Cancel</button></div>
            </form>}
            <div className="cc-profile-field cc-account-email"><div><strong>Email</strong><p>{me.email}</p></div><Stamp tone="warn">PRIVATE</Stamp></div>
          </div>
        </div>
        {save.isSuccess && <p role="status" className="cc-form-hint">Profile saved.</p>}
      </section>
      <div className="cc-account-settings">
        <ContactControls key={me.id} />
        <div className="cc-account-options">
          <PushControls userId={me.id} />
          <section className="cc-account-session" aria-label="Session"><p>Signed in on this browser</p><button type="button" disabled={pending} className="cc-profile-secondary" onClick={() => void logout()}>{pending ? 'Signing out…' : 'Sign out'}</button><span className="cc-session-mobile-hint">This browser</span>{error && <p role="alert" className="cc-form-error">{error}</p>}</section>
          <SupportCard />
        </div>
      </div>
    </div>
  </main>
}
