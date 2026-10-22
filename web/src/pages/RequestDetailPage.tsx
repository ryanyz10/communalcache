import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useProfile } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import type { ItemRequest } from '../lib/requests'
import { Cat } from '../components/Cat'
import { Avatar } from '../components/Avatar'
import { Stamp } from '../components/Stamp'
import { ThingNameArt, thingTone } from '../components/ThingTile'
import { RequestDetailSkeleton } from '../components/skeletons/RequestSkeletons'
import { ApprovedContact } from '../components/RequestContact'
import { RequestCard } from '../components/RequestCard'

export function RequestDetailPage() {
  const { requestId = '' } = useParams()
  const me = useProfile()
  const requestQuery = useQuery({
    queryKey: ['request-detail', me.id, requestId],
    queryFn: () => apiFetch<ItemRequest>(`/api/me/requests/${requestId}`),
    enabled: !!me.display_name,
  })

  let requestContent: ReactNode
  if (requestQuery.isSuccess) {
    const request = requestQuery.data
    if (request.status === 'approved') {
      const heading = me.id === request.owner_id
        ? `You said yes to ${request.requester_name ?? 'a neighbor'}`
        : `${request.owner_name ?? 'The owner'} said yes`
      requestContent = <>
        <div className="cc-approved-item">
          <span className="cc-approved-cats" aria-hidden="true">
            <span><Cat userId={request.owner_id} coat={request.owner_cat_coat} pose="sit" /></span>
            <span><Cat userId={request.requester_id} coat={request.requester_cat_coat} pose="sit" /></span>
          </span>
          <div className={`cc-approved-name-tile cc-thing-tile cc-thing-tile-${thingTone(request.item_id)}`}>
            <ThingNameArt title={request.item_title} />
            <Stamp tone="ok">Approved</Stamp>
          </div>
        </div>
        <div className="cc-approved-copy">
          <div className="cc-approved-heading">
            <h1>{heading}</h1>
            <p>{request.item_title} · {request.cache_name}</p>
          </div>
          {request.approval_message && <div className="cc-approved-note">
            <Avatar
              userId={request.owner_id}
              name={request.owner_name ?? 'Member'}
              coat={request.owner_cat_coat}
              photoVersion={request.owner_photo_version}
              size={30}
            />
            <p>{request.approval_message}</p>
          </div>}
          <ApprovedContact request={request} callerId={me.id} focused />
        </div>
        <p className="cc-approved-handoff">Hand it off in person. Nothing else to do here.</p>
      </>
    } else {
      requestContent = <div className="cc-request-detail-state">
        <h1>{request.status === 'pending' ? 'Waiting for an answer' : 'Ask declined'}</h1>
        <ul className="cc-request-slip"><RequestCard request={request} callerId={me.id} /></ul>
      </div>
    }
  }

  return <main className="organic-request-detail">
    <nav className="cc-request-back">
      <Link to="/requests">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        Requests
      </Link>
    </nav>
    {requestQuery.isPending && <RequestDetailSkeleton embedded />}
    {requestQuery.isError && <div className="cc-request-detail-state">
      <p role="alert" className="cc-form-error">{errorMessage(requestQuery.error)}</p>
      <button type="button" className="cc-text-action" onClick={() => void requestQuery.refetch()}>Try ask again</button>
    </div>}
    {requestContent}
  </main>
}
