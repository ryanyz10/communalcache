import type { QueryClient } from '@tanstack/react-query'
import { invalidateRequestViews } from './requests'
import { cacheKeys } from './caches'
import { joiningKeys } from './joining'
import { ApiError, apiFetch, type Me } from './api'

export const meKey = () => ['me']
export const meQuery = (loaded: (me: Me | null, signal: AbortSignal) => Promise<void>) => ({
  queryKey: meKey(),
  queryFn: async ({ signal }: { signal: AbortSignal }) => {
    let me: Me | null
    try { me = await apiFetch<Me>('/api/me', { signal }) }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error
      me = null
    }
    signal.throwIfAborted()
    await loaded(me, signal)
    return me
  },
})

export function refreshProfileViews(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: meKey() }),
    client.invalidateQueries({ queryKey: cacheKeys.detailPrefix() }),
    client.invalidateQueries({ queryKey: joiningKeys.requestsPrefix() }),
    invalidateRequestViews(client),
  ])
}
