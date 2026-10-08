import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'

export function OnboardingPage() {
  const { refresh } = useAuth()
  const [name, setName] = useState('')
  const mutation = useMutation({
    mutationFn: (displayName: string) => apiFetch('/api/me', { method: 'PATCH', body: { display_name: displayName } }),
    onSuccess: refresh,
  })
  function onSubmit(event: FormEvent) { event.preventDefault(); mutation.mutate(name) }

  return <main className="mx-auto max-w-md px-4 py-12">
    <h1 className="text-2xl font-semibold tracking-tight">What should neighbors call you?</h1>
    <p className="mt-2 text-slate-600">This is the only name other members see. Keep it short.</p>
    <form className="mt-8 space-y-4" onSubmit={onSubmit}>
      <div>
        <label htmlFor="display_name" className="block text-sm font-medium">Display name</label>
        <input id="display_name" name="display_name" type="text" autoComplete="nickname" required maxLength={60}
          value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
      </div>
      {mutation.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(mutation.error)}</p>}
      <button type="submit" disabled={mutation.isPending} className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60">
        {mutation.isPending ? 'Saving…' : 'Continue'}
      </button>
    </form>
  </main>
}
