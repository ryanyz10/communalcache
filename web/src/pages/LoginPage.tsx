import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { peekJoinToken } from '../lib/joinToken'

export function LoginPage() {
  const { supabase, config, session, ready } = useAuth()
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (ready && session) {
    return <Navigate to="/" replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !config) return
    setPending(true)
    setError(null)
    setSent(false)

    const joinToken = peekJoinToken()
    const emailRedirectTo = joinToken
      ? `${config.app_base_url}/join/${joinToken}`
      : `${config.app_base_url}/`

    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo },
    })
    setPending(false)
    if (err) {
      setError(err.message)
      return
    }
    setSent(true)
  }

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Communal Cache</h1>
      <p className="mt-2 text-slate-600">
        Sign in with a magic link. We never store your address — just your email
        for login.
      </p>

      <form className="mt-8 space-y-4" onSubmit={onSubmit}>
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {sent ? (
          <p role="status" className="text-sm text-emerald-700">
            Check your email for the magic link.
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
        >
          {pending ? 'Sending…' : 'Send magic link'}
        </button>
      </form>
    </main>
  )
}
