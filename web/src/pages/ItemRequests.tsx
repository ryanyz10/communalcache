import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import type { Item } from '../lib/items'
import { relativeWhen, requesterQueueLabel, type ItemRequest } from '../lib/requests'
import { Stamp } from '../components/Stamp'
import { Avatar } from '../components/Avatar'
import { SkeletonRows } from '../components/Skeleton'
import { AskSheet } from './AskSheet'
import { RequestCard } from './RequestCard'

export function ItemRequests({ item, askOpen, onAskClose, cacheName }: {
  item: Item
  askOpen: boolean
  onAskClose: () => void
  cacheName?: string
}) {
  const { me } = useAuth()
  const requestsQuery = useQuery({
    queryKey: ['item-requests', item.cache_id, item.id],
    queryFn: () => apiFetch<ItemRequest[]>(`/api/caches/${item.cache_id}/items/${item.id}/requests`),
    enabled: !!me?.display_name,
  })

  return <section className="cc-detail-requests" aria-labelledby="requests-heading">
    <div className="cc-detail-requests-title">
      <h2 id="requests-heading">Asks</h2>
      <p>Pending asks are visible to the cache. Decisions stay between the two people.</p>
    </div>
    {requestsQuery.isPending && <SkeletonRows label="Loading requests…" kind="requests" count={2} />}
    {requestsQuery.isError && <div>
      <p role="alert" className="cc-form-error">{errorMessage(requestsQuery.error)}</p>
      <button type="button" className="cc-text-action" disabled={requestsQuery.isFetching} onClick={() => void requestsQuery.refetch()}>Try requests again</button>
    </div>}
    {requestsQuery.isSuccess && <>
      {item.available === false && <p className="cc-form-hint">Lent out. Existing requests can still be decided.</p>}
      <ul className="cc-detail-ask-list">
        {requestsQuery.data.map(request => {
          const showPendingSummary = request.status === 'pending' && me?.id !== item.owner_id
          if (!showPendingSummary) return <RequestCard key={request.id} request={request} callerId={me?.id ?? ''} />

          const requesterName = request.requester_name ?? 'Member'
          return <li key={request.id} className="cc-pending-ask-row">
            <Avatar
              userId={request.requester_id}
              name={requesterName}
              coat={request.requester_cat_coat}
              photoVersion={request.requester_photo_version}
              size={30}
            />
            <span><b>{requesterName}</b> asked {relativeWhen(request.created_at)}{request.quantity !== null ? ` for ${request.quantity}` : ''}
              {requesterQueueLabel(request, me?.id ?? '') && <span className="cc-request-queue-position"> · {requesterQueueLabel(request, me?.id ?? '')}</span>}
            </span>
            <Stamp>Pending</Stamp>
          </li>
        })}
        {!requestsQuery.data.length && <li className="cc-list-empty">No visible requests for this item yet.</li>}
      </ul>
    </>}
    {askOpen && me?.id !== item.owner_id && <AskSheet
      item={item}
      cacheName={cacheName}
      onClose={onAskClose}
    />}
  </section>
}
