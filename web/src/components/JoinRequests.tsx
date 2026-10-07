import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, ApiError, type JoinRequest } from '../lib/api'

export function JoinRequests({ cacheID }: { cacheID: string }) {
  const { session, user } = useAuth()
  const queryClient = useQueryClient()
  const queue = useQuery({
    queryKey: ['join-requests', cacheID, user?.id],
    enabled: !!session,
    queryFn: () => apiFetch<JoinRequest[]>(`/api/caches/${cacheID}/join-requests`, { session }),
  })
  const decide = useMutation({
    mutationFn: ({ userID, decision }: { userID: string; decision: 'approve' | 'reject' }) =>
      apiFetch<void>(`/api/caches/${cacheID}/join-requests/${userID}/${decision}`, {
        method: 'POST', session,
        onProfileIncomplete: () => {
          void queryClient.invalidateQueries({ queryKey: ['me'] })
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['join-requests', cacheID] }),
        queryClient.invalidateQueries({ queryKey: ['cache', cacheID] }),
      ])
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 404) {
        void queryClient.invalidateQueries({ queryKey: ['join-requests', cacheID] })
      }
    },
  })

  return (
    <div className="mt-6" aria-labelledby="join-requests-heading">
      <h3 id="join-requests-heading" className="text-lg font-semibold">Pending join requests</h3>
      {queue.isPending ? <p className="mt-2 text-sm text-slate-600">Loading requests…</p> : null}
      {queue.isError ? (
        <div className="mt-2">
          <p role="alert" className="text-sm text-red-700">Could not load join requests.</p>
          <button type="button" className="mt-2 rounded-md border px-3 py-2" onClick={() => void queue.refetch()}>Try again</button>
        </div>
      ) : null}
      {queue.data?.length === 0 ? <p className="mt-2 text-sm text-slate-600">No pending join requests.</p> : null}
      {decide.isError ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {decide.error instanceof ApiError && decide.error.status === 404
            ? 'This request is no longer pending, or you no longer have access.'
            : 'Could not decide this request. Please try again.'}
        </p>
      ) : null}
      <ul className="mt-3 space-y-3">
        {queue.data?.map((request) => (
          <li key={request.user_id} className="rounded-md border border-slate-200 bg-white px-4 py-3">
            <p className="break-words font-medium">{request.display_name ?? 'Member'}</p>
            <time dateTime={request.created_at} className="mt-1 block text-sm text-slate-600">
              {new Date(request.created_at).toLocaleString()}
            </time>
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" disabled={decide.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-white disabled:opacity-60"
                onClick={() => decide.mutate({ userID: request.user_id, decision: 'approve' })}>
                {decide.isPending && decide.variables?.userID === request.user_id && decide.variables.decision === 'approve' ? 'Approving…' : 'Approve'}
              </button>
              <button type="button" disabled={decide.isPending} className="rounded-md border border-slate-300 px-3 py-2 disabled:opacity-60"
                onClick={() => decide.mutate({ userID: request.user_id, decision: 'reject' })}>
                {decide.isPending && decide.variables?.userID === request.user_id && decide.variables.decision === 'reject' ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
