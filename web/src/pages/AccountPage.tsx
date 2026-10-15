import { useRef, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import { OnboardingPage } from './OnboardingPage'
import { PushControls } from './PushControls'

export function AccountPage() {
  const { me, refresh, signOut } = useAuth()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(me?.display_name ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const edit = useRef<HTMLButtonElement>(null)
  const save = useMutation({
    mutationFn: () => apiFetch('/api/me', { method: 'PATCH', body: { display_name: name } }),
    onSuccess: async () => { await refresh(); setEditing(false); edit.current?.focus() },
  })
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  function submit(event: FormEvent) { event.preventDefault(); save.mutate() }
  async function logout() {
    setPending(true); setError('')
    try { await signOut() } catch (error) { setError(errorMessage(error)) } finally { setPending(false) }
  }
  return <main className="cc-page">
    <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
    <section className="mt-6" aria-labelledby="profile-heading">
      <h2 id="profile-heading" className="cc-section-title">Profile</h2>
      <div className="cc-list">
        <div className="cc-row">
          <div className="min-w-0 flex-1"><p className="font-semibold">Display name</p><p className="break-words text-sm text-slate-600">{me.display_name} · what neighbors see</p></div>
          <button ref={edit} type="button" className="text-sm underline" onClick={() => { setName(me.display_name!); save.reset(); setEditing(true) }} aria-expanded={editing}>Edit<span className="sr-only"> display name</span></button>
        </div>
        {editing && <form onSubmit={submit} className="border-t border-slate-100 p-4"><label htmlFor="account-name" className="block text-sm font-medium">Display name</label><input autoFocus id="account-name" className="cc-input" required maxLength={60} value={name} onChange={event => setName(event.target.value)} />
          {save.isError && <p role="alert" className="mt-2 text-sm text-red-700">{errorMessage(save.error)}</p>}
          <div className="mt-3 flex gap-2"><button className="cc-pill" disabled={save.isPending || !name.trim()}>{save.isPending ? 'Saving…' : 'Save name'}</button><button type="button" className="cc-outline" disabled={save.isPending} onClick={() => { setEditing(false); edit.current?.focus() }}>Cancel</button></div>
        </form>}
        <div className="cc-row"><div className="min-w-0"><p className="font-semibold">Email</p><p className="break-all text-sm text-slate-600">{me.email} · private</p></div></div>
      </div>
      {save.isSuccess && <p role="status" className="mt-2 text-sm text-emerald-700">Profile saved.</p>}
    </section>
    <PushControls userId={me.id} />
    {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
    <button type="button" disabled={pending} className="mt-8 w-full rounded-md border border-slate-300 px-4 py-2" onClick={() => void logout()}>{pending ? 'Signing out…' : 'Sign out'}</button>
  </main>
}
