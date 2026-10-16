import type { QueryClient } from '@tanstack/react-query'
import { invalidateRequestViews } from './requests'

export function refreshProfileViews(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['me'] }),
    client.invalidateQueries({ queryKey: ['cache'] }),
    client.invalidateQueries({ queryKey: ['join-requests'] }),
    invalidateRequestViews(client),
  ])
}
