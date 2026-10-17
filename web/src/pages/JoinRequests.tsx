import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, errorMessage } from '../lib/api'
import type { JoinRequest } from '../lib/joining'
import { Avatar } from '../components/Avatar'
import { SkeletonRows } from '../components/Skeleton'

export function JoinRequests({ cacheId }: { cacheId: string }) {
  const queryClient = useQueryClient()
  const joinRequestsQuery = useQuery({
    queryKey: ['join-requests', cacheId],
    queryFn: () => apiFetch<JoinRequest[]>(`/api/caches/${cacheId}/join-requests`),
  })
  const decideJoin = useMutation({
    mutationFn: ({ userId, decision }: { userId: string; decision: 'approve' | 'reject' }) => apiFetch(`/api/caches/${cacheId}/join-requests/${userId}/${decision}`, { body: {} }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['join-requests', cacheId] })
      await queryClient.invalidateQueries({ queryKey: ['cache', cacheId] })
      await queryClient.invalidateQueries({ queryKey: ['caches'] })
    },
  })

  return <section className="mt-6 lg:mt-0 lg:scroll-mt-[84px] lg:rounded-[14px] lg:border lg:border-slate-200 lg:bg-white lg:p-4" aria-labelledby="join-requests-heading" id="join-requests">
    <h2 id="join-requests-heading" className="cc-section-title lg:mb-3 lg:ml-0 lg:text-[17px] lg:tracking-normal lg:text-slate-900 lg:normal-case">Join requests</h2>
    {joinRequestsQuery.isPending && <SkeletonRows label="Loading join requests…" kind="members" count={2} />}
    {joinRequestsQuery.isError && <div className="mt-3">
      <p role="alert" className="text-red-700">{errorMessage(joinRequestsQuery.error)} Previously loaded join requests may be out of date.</p>
      <button type="button" className="mt-2 text-sm underline" disabled={joinRequestsQuery.isFetching} onClick={() => void joinRequestsQuery.refetch()}>Try join requests again</button>
    </div>}
    {joinRequestsQuery.isSuccess && joinRequestsQuery.data.length === 0 && <p className="mt-3 text-slate-600">No pending join requests.</p>}
    {decideJoin.isPending && <p role="status" className="mt-3">Saving join decision…</p>}
    {decideJoin.isError && <p role="alert" className="mt-3 text-red-700">{errorMessage(decideJoin.error)}</p>}
    {decideJoin.isSuccess && <p role="status" className="mt-3 text-emerald-700">Join request decided.</p>}
    {!!joinRequestsQuery.data?.length && <ul className="cc-list lg:border-0">
      {joinRequestsQuery.data.map(request => <li key={request.user_id} className="cc-row flex-wrap">
        <Avatar userId={request.user_id} name={request.display_name ?? 'Neighbor'} photoVersion={request.profile_photo_version} coat={request.cat_coat} />
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold">{request.display_name ?? 'Neighbor'}</p>
          <p className="text-sm text-slate-600">Requested {new Date(request.created_at).toLocaleDateString()}</p>
        </div>
        <div className="flex gap-1.5">
          <button type="button" disabled={decideJoin.isPending} onClick={() => decideJoin.mutate({ userId: request.user_id, decision: 'approve' })} className="cc-pill px-3 py-1" aria-label={`Approve ${request.display_name ?? 'neighbor'}`}>Approve</button>
          <button type="button" disabled={decideJoin.isPending} onClick={() => decideJoin.mutate({ userId: request.user_id, decision: 'reject' })} className="cc-outline px-3 py-1" aria-label={`Reject ${request.display_name ?? 'neighbor'}`}>Reject</button>
        </div>
      </li>)}
    </ul>}
  </section>
}
