import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { libraryItemQuery } from '../lib/items'
import { relativeWhen, stockAfterApproval, type ItemRequest } from '../lib/requests'
import { RequestStatus } from '../components/RequestStatus'
import { Avatar } from '../components/Avatar'
import { Shimmer, LoadingStatus } from '../components/Skeleton'
import { RequestDecision } from './RequestDecision'
import { ApprovedContact } from './RequestContact'

function OwnerStock({ request, callerId }: { request: ItemRequest; callerId: string }) {
  const stockQuery = useQuery({
    ...libraryItemQuery(callerId, request.item_id),
    enabled: request.owner_id === callerId && request.status === 'pending' && request.quantity !== null,
  })
  if (stockQuery.isPending) {
    return <span className="cc-skeleton-inline">
      <LoadingStatus label="Checking stock…" />
      <Shimmer width={90} height={12} />
    </span>
  }
  if (stockQuery.isError) {
    return <span> · stock unavailable <button type="button" className="cc-stock-retry" onClick={() => void stockQuery.refetch()}>Retry stock</button></span>
  }
  if (stockQuery.data.owner_id !== callerId || typeof stockQuery.data.quantity !== 'number' || request.quantity === null) return null

  const stockLeft = stockAfterApproval(stockQuery.data.quantity, request.quantity)
  return <span> · {stockLeft >= 0 ? `${stockLeft} left after this` : 'not enough stock to approve'}</span>
}

export function RequestCard({ request, callerId, compactAnswered = false }: {
  request: ItemRequest
  callerId: string
  compactAnswered?: boolean
}) {
  const isIncoming = request.owner_id === callerId
  const isParty = isIncoming || request.requester_id === callerId
  const needsAnswer = isIncoming && request.status === 'pending'
  const isAnswered = isIncoming && request.status !== 'pending'
  const compactAnsweredCard = isAnswered && compactAnswered
  const isCompact = compactAnsweredCard || (!isIncoming && request.status !== 'approved')
  const personId = isIncoming ? request.requester_id : request.owner_id
  const personName = (isIncoming ? request.requester_name : request.owner_name) ?? 'Member'
  const photoVersion = isIncoming ? request.requester_photo_version : request.owner_photo_version
  const catCoat = isIncoming ? request.requester_cat_coat : request.owner_cat_coat
  const itemPath = `/caches/${request.cache_id}/items/${request.item_id}`

  let time: string
  if (request.status === 'approved' && !isIncoming) {
    const approvedWhen = request.decided_at && Date.now() - request.decided_at < 86_400_000
      ? 'today'
      : relativeWhen(request.decided_at ?? request.created_at)
    time = `approved ${approvedWhen}`
  } else if (request.status === 'pending' && !isIncoming) {
    time = `asked ${relativeWhen(request.created_at)}`
  } else {
    time = relativeWhen(request.decided_at ?? request.created_at)
  }

  let description: ReactNode
  if (needsAnswer) {
    const askDescription = request.quantity === null ? 'asked to use your ' : `asked for ${request.quantity} `
    description = <><b>{personName}</b>{' '}{askDescription}<Link to={itemPath}><b>{request.item_title}</b></Link></>
  } else if (isIncoming) {
    description = <><b>{personName}</b>{' · '}<Link to={itemPath}>{request.item_title}</Link></>
  } else {
    description = <><Link to={itemPath}><b>{request.item_title}</b></Link>{' from '}{personName}</>
  }

  return <li className={`cc-request-card${needsAnswer ? ' cc-request-card-incoming' : ''}${isCompact ? ' cc-request-card-compact' : ''}`}>
    <div className="cc-request-person-row">
      <Avatar userId={personId} name={personName} photoVersion={photoVersion} coat={catCoat} size={isCompact ? 34 : 40} />
      <div className="cc-request-copy">
        <p>{description}</p>
        <p className="cc-request-meta">
          {request.status === 'rejected' ? `Reason: ${request.decision_reason ?? 'Declined'}` : <>
            {request.cache_name} · {time}
            {needsAnswer && request.quantity !== null && <OwnerStock request={request} callerId={callerId} />}
          </>}
        </p>
      </div>
      {!needsAnswer && (request.status === 'approved' && isParty
        ? <Link
            to={`/requests/${request.id}`}
            aria-label={`Approved ask for ${request.item_title}: view handoff details`}
            className="cc-approved-detail-link"
          ><RequestStatus status={request.status} /></Link>
        : <RequestStatus status={request.status} />)}
    </div>
    {request.status === 'approved' && isParty && !compactAnsweredCard && <>
      {request.approval_message && <p className="cc-private-note">{request.approval_message}</p>}
      <div className="cc-card-contact"><ApprovedContact request={request} callerId={callerId} /></div>
    </>}
    {needsAnswer && <RequestDecision request={request} />}
  </li>
}
