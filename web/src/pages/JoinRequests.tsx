import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, errorMessage } from '../lib/api'
import type { JoinRequest } from '../lib/joining'

export function JoinRequests({ cacheId }: { cacheId: string }) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['join-requests', cacheId], queryFn: () => apiFetch<JoinRequest[]>(`/api/caches/${cacheId}/join-requests`) })
  const decide = useMutation({
    mutationFn: ({ userId, decision }: { userId: string; decision: 'approve' | 'reject' }) => apiFetch(`/api/caches/${cacheId}/join-requests/${userId}/${decision}`, { body: {} }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['join-requests', cacheId] })
      await queryClient.invalidateQueries({ queryKey: ['cache', cacheId] })
    },
  })
  return <section className="mt-8" aria-labelledby="join-requests-heading">
    <h2 id="join-requests-heading" className="text-xl font-semibold">Join requests</h2>
    <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="mt-2 underline">Refresh requests</button>
    {query.isPending && <p role="status" className="mt-3">Loading join requests…</p>}
    {query.isError && <p role="alert" className="mt-3 text-red-700">{errorMessage(query.error)} Previously loaded join requests may be out of date.</p>}
    {query.isSuccess && query.data.length === 0 && <p className="mt-3 text-slate-600">No pending join requests.</p>}
    {decide.isPending && <p role="status" className="mt-3">Saving join decision…</p>}
    {decide.isError && <p role="alert" className="mt-3 text-red-700">{errorMessage(decide.error)}</p>}
    {decide.isSuccess && <p role="status" className="mt-3 text-emerald-700">Join request decided.</p>}
    <ul className="mt-3 space-y-4">{query.data?.map(request => <li key={request.user_id} className="rounded-md border border-slate-300 p-3">
      <p className="font-medium">{request.display_name ?? 'Neighbor'}</p>
      <p className="text-sm text-slate-600">Requested {new Date(request.created_at).toLocaleDateString()}</p>
      <div className="mt-3 flex gap-3">
        <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ userId: request.user_id, decision: 'approve' })} className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60" aria-label={`Approve ${request.display_name ?? 'neighbor'}`}>Approve</button>
        <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ userId: request.user_id, decision: 'reject' })} className="rounded-md border border-slate-300 px-4 py-2 disabled:opacity-60" aria-label={`Reject ${request.display_name ?? 'neighbor'}`}>Reject</button>
      </div>
    </li>)}</ul>
  </section>
}
