import { useNavigate, useParams } from 'react-router'
import { useEffect } from 'react'
import { stashJoinToken } from './LoginPage'
import { useAuth } from '../auth/AuthProvider'

export function JoinPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { session, ready } = useAuth()

  useEffect(() => {
    if (!token) return
    stashJoinToken(token)
  }, [token])

  useEffect(() => {
    if (!ready) return
    if (!session) {
      navigate('/login', { replace: true })
      return
    }
    // Joining ships in Feature 2; preserve the token until then.
    navigate('/', { replace: true })
  }, [ready, session, navigate])

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <p className="text-slate-600">Opening invite…</p>
    </main>
  )
}
