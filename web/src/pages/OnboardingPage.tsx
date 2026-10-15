import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import { AuthScreen } from '../components/AuthScreen'
import { NamePreview } from '../components/NamePreview'

export function OnboardingPage() {
  const { refresh } = useAuth()
  const [name, setName] = useState('')
  const mutation = useMutation({
    mutationFn: (displayName: string) => apiFetch('/api/me', { method: 'PATCH', body: { display_name: displayName } }),
    onSuccess: refresh,
  })
  function onSubmit(event: FormEvent) { event.preventDefault(); mutation.mutate(name) }

  return <AuthScreen>
    <header className="mt-10 text-center">
      <NamePreview name={name} />
      <h1 className="cc-auth-heading">What should neighbors call you?</h1>
      <p className="mt-2 text-slate-600">This is the only name other members see.</p>
    </header>
    <form className="cc-auth-card mt-8" onSubmit={onSubmit}>
      <div>
        <label htmlFor="display_name" className="block text-sm font-medium">Display name</label>
        <input id="display_name" name="display_name" type="text" autoComplete="nickname" required maxLength={60}
          value={name} onChange={event => setName(event.target.value)} className="cc-auth-input" />
      </div>
      {mutation.isError && <p role="alert" className="mt-3 text-sm text-red-700">{errorMessage(mutation.error)}</p>}
      <button type="submit" disabled={mutation.isPending} className="cc-auth-primary mt-4">
        {mutation.isPending ? 'Saving…' : 'Continue'}
      </button>
    </form>
  </AuthScreen>
}
