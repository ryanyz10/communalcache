import { createContext, useContext, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch, errorMessage, type Me } from '../lib/api'
import { disablePush } from '../lib/push'
import { clearJoinToken } from '../lib/pendingJoin'
import { setSessionHint } from '../lib/sessionHint'

type AuthState = {
  ready: boolean
  me: Me | null
  error: string | null
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const me = await apiFetch<Me>('/api/me')
        setSessionHint(!!me?.id)
        return me
      }
      catch (error) {
        if (error instanceof ApiError && error.status === 401) { setSessionHint(false); return null }
        throw error
      }
    },
  })
  async function refresh() { await queryClient.invalidateQueries({ queryKey: ['me'] }) }
  async function signOut() {
    await disablePush()
    await apiFetch('/api/auth/sign-out', { body: {} })
    setSessionHint(false)
    clearJoinToken()
    queryClient.setQueryData(['me'], null)
    queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'me' })
  }
  return <AuthContext.Provider value={{
    ready: !query.isPending,
    me: query.data ?? null,
    error: query.isError ? errorMessage(query.error) : null,
    refresh,
    signOut,
  }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth requires AuthProvider')
  return context
}
