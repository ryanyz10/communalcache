import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, errorMessage, type Me } from '../lib/api'
import { disablePush, reconcilePushAccount, setPushAccount } from '../lib/push'
import { clearJoinToken } from '../lib/pendingJoin'
import { setSessionHint } from '../lib/sessionHint'
import { meKey, meQuery } from '../lib/profile'

type AuthState = {
  ready: boolean
  me: Me | null
  error: string | null
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)
const channelName = 'communalcache-session'
const privateQuery = (query: { queryKey: readonly unknown[] }) => !['me', 'config'].includes(String(query.queryKey[0]))

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const currentId = useRef(queryClient.getQueryData<Me | null>(meKey())?.id ?? null)
  const announcedId = useRef<string | null | undefined>(undefined)
  const channel = useRef<BroadcastChannel | null>(null)
  const revision = useRef(0)
  const [checking, setChecking] = useState(false)

  function announce(userId: string | null) {
    announcedId.current = userId
    const message = { type: 'session-changed', userId }
    if (channel.current) channel.current.postMessage(message)
    else if (typeof window !== 'undefined') {
      try { localStorage.setItem(channelName, JSON.stringify({ ...message, nonce: crypto.randomUUID() })) } catch { /* Visibility revalidation remains available. */ }
    }
  }

  const clearPrivate = useCallback(async () => {
    await queryClient.cancelQueries({ predicate: privateQuery })
    queryClient.removeQueries({ predicate: privateQuery })
    queryClient.getMutationCache().clear()
  }, [queryClient])

  const query = useQuery(meQuery(async (me, signal) => {
    const userId = me?.id ?? null
    if (currentId.current !== userId) await clearPrivate()
    signal.throwIfAborted()
    await reconcilePushAccount(userId, signal)
    signal.throwIfAborted()
    setSessionHint(!!userId)
    currentId.current = userId
    if (announcedId.current !== userId) announce(userId)
  }))

  const refresh = useCallback(async () => {
    const attempt = ++revision.current
    setChecking(true)
    await queryClient.cancelQueries({ predicate: query => query.queryKey[0] !== 'config' })
    await setPushAccount(null)
    await clearPrivate()
    if (attempt !== revision.current) return
    queryClient.setQueryData(meKey(), null)
    try { await queryClient.refetchQueries({ queryKey: meKey(), exact: true }, { throwOnError: true }) }
    finally { if (attempt === revision.current) setChecking(false) }
  }, [queryClient, clearPrivate])

  useEffect(() => {
    function receive(message: unknown) {
      const data = message as { type?: unknown; userId?: unknown } | null
      if (data?.type !== 'session-changed' || (data.userId !== null && typeof data.userId !== 'string')) return
      // A peer's ID only suppresses echoes; /api/me remains the identity authority.
      announcedId.current = data.userId
      void refresh().catch(() => {})
    }
    let connection: BroadcastChannel | null = null
    try {
      connection = new BroadcastChannel(channelName)
      connection.onmessage = event => receive(event.data)
      channel.current = connection
    } catch { /* Older/private browsers use the storage event instead. */ }
    function storage(event: StorageEvent) {
      if (event.key !== channelName || !event.newValue) return
      try { receive(JSON.parse(event.newValue)) } catch { /* Ignore malformed hints. */ }
    }
    const page = document
    function visibility() {
      if (page.visibilityState === 'hidden') setChecking(true)
      else void refresh().catch(() => {})
    }
    if (!connection) window.addEventListener('storage', storage)
    page.addEventListener('visibilitychange', visibility)
    return () => {
      connection?.close()
      channel.current = null
      if (!connection) window.removeEventListener('storage', storage)
      page.removeEventListener('visibilitychange', visibility)
    }
  }, [refresh])

  async function signOut() {
    await disablePush()
    await apiFetch('/api/auth/sign-out', { body: {} })
    ++revision.current
    setChecking(true)
    await queryClient.cancelQueries({ predicate: query => query.queryKey[0] !== 'config' })
    await setPushAccount(null)
    await clearPrivate()
    currentId.current = null
    setSessionHint(false)
    clearJoinToken()
    queryClient.setQueryData(meKey(), null)
    announce(null)
    setChecking(false)
  }
  const fetching = query.isFetching && queryClient.getQueryState(meKey())?.fetchStatus === 'fetching'
  const ready = !checking && !query.isPending && !fetching
  return <AuthContext.Provider value={{
    ready,
    me: ready ? query.data ?? null : null,
    error: query.isError ? errorMessage(query.error) : null,
    refresh,
    signOut,
  }}>{children}</AuthContext.Provider>
}

export function useProfile(): Me & { display_name: string } {
  const { me } = useAuth()
  if (!me?.display_name) throw new Error('useProfile needs RequireProfile')
  return { ...me, display_name: me.display_name }
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth requires AuthProvider')
  return context
}
