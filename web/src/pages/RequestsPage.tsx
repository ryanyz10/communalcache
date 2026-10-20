import { Link, Navigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/api'
import { useRequests, type ItemRequest } from '../lib/requests'
import { useHomeSummary } from '../lib/caches'
import { useOwnContact } from '../lib/contacts'
import { RequestsSkeleton } from '../components/skeletons/RequestSkeletons'
import { Shimmer, LoadingStatus } from '../components/Skeleton'
import { OnboardingPage } from './OnboardingPage'
import { RequestCard } from './RequestCard'

export function RequestsPage() {
  const { me } = useAuth()
  const requestsQuery = useRequests(!!me?.display_name)
  const incomingQuery = useRequests(!!me?.display_name, 'incoming')
  const summaryQuery = useHomeSummary(!!me?.display_name)
  const ownContactQuery = useOwnContact(me?.id ?? '')
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />

  const requests = requestsQuery.data?.pages.flatMap(page => page.requests) ?? []
  const unavailableCaches = requestsQuery.data?.pages.flatMap(page => page.unavailable_cache_ids) ?? []
  const incomingRequests = incomingQuery.data?.pages.flatMap(page => page.requests) ?? []
  const itemQueues = new Map<string, ItemRequest[]>()
  for (const request of incomingRequests) {
    const queue = itemQueues.get(request.item_id) ?? []
    queue.push(request)
    itemQueues.set(request.item_id, queue)
  }
  const answeredRequests = requests.filter(request => request.owner_id === me.id && request.status !== 'pending')
  const outgoingRequests = requests.filter(request => request.requester_id === me.id)

  function renderGroup(heading: string, groupRequests: ItemRequest[], emptyMessage: string) {
    const mayBeIncomplete = unavailableCaches.length || requestsQuery.isError || requestsQuery.hasNextPage
    return <section className="cc-request-group" aria-label={heading}>
      <div className="cc-request-group-heading">
        <h2>{heading}</h2>
      </div>
      <ul className="cc-request-slip">
        {groupRequests.map(request => <RequestCard
          key={request.id}
          request={request}
          callerId={me!.id}
          compactAnswered={heading === 'Answered for your things'}
        />)}
        {!groupRequests.length && (requestsQuery.isPending
          ? <li><LoadingStatus label="Loading request history…" /></li>
          : <li className="cc-list-empty">{emptyMessage}{mayBeIncomplete ? ' This list may be incomplete.' : ''}</li>)}
      </ul>
    </section>
  }

  return <main className="organic-requests">
    <h1>Requests</h1>
    {ownContactQuery.isSuccess && !ownContactQuery.data.contact && <aside className="cc-contact-nudge">
      <h2>Add how to reach you</h2>
      <p>The other person sees it after approval, while you're both active in that cache.</p>
      <Link to="/account">Add contact</Link>
    </aside>}
    {requestsQuery.isPending && incomingQuery.isPending && <RequestsSkeleton embedded pendingAnswerCount={summaryQuery.isError ? undefined : summaryQuery.data?.pending_answer_count} />}
    {requestsQuery.isError && <div className="cc-read-error">
      <p role="alert">{errorMessage(requestsQuery.error)} Some requests may be unavailable.</p>
      <button type="button" disabled={requestsQuery.isFetching} onClick={() => void requestsQuery.refetch()}>Try requests again</button>
    </div>}
    {!!unavailableCaches.length && <div className="cc-read-error">
      <p role="alert">Requests from {unavailableCaches.length} cache(s) could not be loaded. These lists are incomplete.</p>
      <button type="button" disabled={requestsQuery.isFetching} onClick={() => void requestsQuery.refetch()}>Try unavailable caches again</button>
    </div>}
    {(requestsQuery.data || incomingQuery.data || incomingQuery.isError) && <>
      <div className="cc-request-columns">
        <div className="cc-request-owned">
          <section className="cc-request-group" aria-label="Needs your answer">
            <div className="cc-request-group-heading"><h2>Needs your answer</h2>
              {!summaryQuery.isError && !!summaryQuery.data?.pending_answer_count && <span>{summaryQuery.data.pending_answer_count}</span>}
            </div>
            {!!incomingRequests.length && <p className="cc-form-hint">Oldest first for each item. You can answer any ask.</p>}
            {incomingQuery.isPending && <LoadingStatus label="Loading incoming requests…" />}
            {incomingQuery.isError && <div className="cc-read-error">
              <p role="alert">{errorMessage(incomingQuery.error)} Incoming requests may be incomplete.</p>
              <button type="button" disabled={incomingQuery.isFetching} onClick={() => void incomingQuery.refetch()}>Try incoming requests again</button>
            </div>}
            <ul className="cc-request-slip">
              {[...itemQueues].map(([itemId, queue]) => <li key={itemId} className="cc-request-item-queue">
                <h3>{queue[0].item_title}</h3>
                <ul>{queue.map(request => <RequestCard key={request.id} request={request} callerId={me.id} />)}</ul>
              </li>)}
              {!incomingRequests.length && incomingQuery.isSuccess && <li className="cc-list-empty">No asks need your answer in the loaded results.{incomingQuery.hasNextPage ? ' This list may be incomplete.' : ''}</li>}
            </ul>
            {incomingQuery.hasNextPage && <button type="button" className="cc-profile-secondary cc-request-more" disabled={incomingQuery.isFetching} onClick={() => void incomingQuery.fetchNextPage()}>
              {incomingQuery.isFetchingNextPage ? 'Loading incoming requests…' : 'Load more incoming requests'}
            </button>}
          </section>
          {renderGroup('Answered for your things', answeredRequests, 'No answered asks for your things in the loaded results.')}
        </div>
        {renderGroup('Your asks', outgoingRequests, 'None of your asks are visible in the loaded results.')}
      </div>
      {requestsQuery.hasNextPage && <button
        type="button"
        className="cc-profile-secondary cc-request-more"
        disabled={requestsQuery.isFetching}
        onClick={() => void requestsQuery.fetchNextPage()}
      >{requestsQuery.isFetchingNextPage ? <>
        <LoadingStatus label="Loading more requests…" />
        <Shimmer width={140} height={18} />
      </> : 'Load more requests'}</button>}
    </>}
  </main>
}
