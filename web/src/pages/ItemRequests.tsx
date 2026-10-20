import { useState } from 'react'
import { Link } from 'react-router'
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

export function ItemRequests({ item, compact = false, askOpen = false, onAskClose, cacheName }: {
  item: Item
  compact?: boolean
  askOpen?: boolean
  onAskClose?: () => void
  cacheName?: string
}) {
  const { me } = useAuth()
  const [localAskOpen, setLocalAskOpen] = useState(false)
  const requestsQuery = useQuery({
    queryKey: ['item-requests', item.cache_id, item.id],
    queryFn: () => apiFetch<ItemRequest[]>(`/api/caches/${item.cache_id}/items/${item.id}/requests`),
    enabled: !!me?.display_name,
  })
  const showAskSheet = compact ? askOpen : localAskOpen

  return <section className={compact ? 'cc-detail-requests' : 'cc-item-requests'} aria-labelledby="requests-heading">
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
      {!compact && item.is_consumable && item.available_quantity !== undefined && <p>Available now: {item.available_quantity}</p>}
      {!compact && item.is_consumable && (item.available_quantity === undefined || item.available_quantity === null) && <p className="cc-form-hint">Refresh the item to see current availability.</p>}
      {!compact && item.is_consumable && typeof item.available_quantity === 'number' && item.available_quantity <= 0 && <p className="cc-form-hint">No stock available now.</p>}
      {item.available === false && <p className="cc-form-hint">Lent out{item.unavailable_note ? ` · ${item.unavailable_note}` : ''}. Existing requests can still be decided.</p>}
      {!compact && me?.id !== item.owner_id && <button
        type="button"
        className="cc-profile-primary"
        aria-haspopup="dialog"
        onClick={() => setLocalAskOpen(true)}
        disabled={item.available === false || (item.is_consumable && (item.available_quantity ?? 0) <= 0)}
      >{item.is_consumable ? 'Ask for some' : 'Ask to borrow'}</button>}
      <ul className={compact ? 'cc-detail-ask-list' : 'cc-request-slip'}>
        {requestsQuery.data.map(request => {
          const showPendingSummary = compact && request.status === 'pending' && me?.id !== item.owner_id
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
    {showAskSheet && me?.id !== item.owner_id && <AskSheet
      item={item}
      cacheName={cacheName}
      onClose={() => { setLocalAskOpen(false); onAskClose?.() }}
    />}
    {!compact && <Link to="/requests" className="cc-text-action">Your incoming and outgoing requests</Link>}
  </section>
}
