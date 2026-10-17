import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import { AuthScreen } from '../components/AuthScreen'
import { NamePreview } from '../components/NamePreview'
import { CoatPicker } from '../components/CoatPicker'
import type { CatCoat } from '../lib/cats'

export function OnboardingPage() {
  const { me, refresh } = useAuth()
  const [name, setName] = useState('')
  const [coat, setCoat] = useState<CatCoat | null>(me?.cat_coat ?? null)
  const saveProfile = useMutation({
    mutationFn: () => apiFetch('/api/me', { method: 'PATCH', body: { display_name: name, cat_coat: coat } }),
    onSuccess: refresh,
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    saveProfile.mutate()
  }
  if (!me) return null

  return <AuthScreen className="cc-onboarding">
    <NamePreview name={name} userId={me.id} coat={coat} />
    <div className="cc-onboarding-copy"><h1>What should neighbors call you?</h1><p>This is the only name other members see.</p></div>
    <form onSubmit={submit} className="cc-onboarding-form">
      <label htmlFor="display_name" className="sr-only">Display name</label>
      <input
        id="display_name" name="display_name" type="text" autoComplete="nickname" required maxLength={60}
        className="cc-profile-input" value={name} disabled={saveProfile.isPending} onChange={event => setName(event.target.value)}
      />
      <CoatPicker userId={me.id} value={coat} onChange={setCoat} disabled={saveProfile.isPending} label="Pick your cat" />
      {saveProfile.isError && <p role="alert" className="cc-form-error">{errorMessage(saveProfile.error)}</p>}
      <button type="submit" disabled={saveProfile.isPending || !name.trim()} className="cc-profile-primary cc-onboarding-continue">{saveProfile.isPending ? 'Saving…' : 'Continue'}</button>
    </form>
  </AuthScreen>
}
