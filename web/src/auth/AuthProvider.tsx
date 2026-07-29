import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session, SupabaseClient, User } from '@supabase/supabase-js'
import { loadConfig, type AppConfig } from '../lib/config'
import { getSupabase } from '../lib/supabase'

type AuthState = {
  ready: boolean
  config: AppConfig | null
  supabase: SupabaseClient | null
  session: Session | null
  user: User | null
  error: string | null
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<AuthState>({
    ready: false,
    config: null,
    supabase: null,
    session: null,
    user: null,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    let unsub: (() => void) | undefined

    ;(async () => {
      try {
        const config = await loadConfig()
        if (cancelled) return
        const supabase = getSupabase(config)
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        if (cancelled) return

        setState({
          ready: true,
          config,
          supabase,
          session: data.session,
          user: data.session?.user ?? null,
          error: null,
        })

        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
          setState((prev) => {
            const prevId = prev.user?.id
            const nextId = session?.user?.id
            if (prevId !== nextId) {
              queryClient.clear()
            }
            return {
              ...prev,
              session,
              user: session?.user ?? null,
            }
          })
        })
        unsub = () => sub.subscription.unsubscribe()
      } catch (err) {
        if (cancelled) return
        setState({
          ready: true,
          config: null,
          supabase: null,
          session: null,
          user: null,
          error: err instanceof Error ? err.message : 'Failed to start auth',
        })
      }
    })()

    return () => {
      cancelled = true
      unsub?.()
    }
  }, [queryClient])

  const value = useMemo(() => state, [state])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth requires AuthProvider')
  return ctx
}
