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
  const summaryQuery = useHomeSummary(!!me?.display_name)
  const ownContactQuery = useOwnContact(me?.id ?? '')
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />

  const requests = requestsQuery.data?.pages.flatMap(page => page.requests) ?? []
  const unavailableCaches = requestsQuery.data?.pages.flatMap(page => page.unavailable_cache_ids) ?? []
  const incomingRequests = requests.filter(request => request.owner_id === me.id && request.status === 'pending')
  const answeredRequests = requests.filter(request => request.owner_id === me.id && request.status !== 'pending')
  const outgoingRequests = requests.filter(request => request.requester_id === me.id)

  function renderGroup(heading: string, groupRequests: ItemRequest[], emptyMessage: string) {
    const showPendingCount = heading === 'Needs your answer' && !summaryQuery.isError && !!summaryQuery.data?.pending_answer_count
    const mayBeIncomplete = unavailableCaches.length || requestsQuery.isError || requestsQuery.hasNextPage
    return <section className="cc-request-group" aria-label={heading}>
      <div className="cc-request-group-heading">
        <h2>{heading}</h2>
        {showPendingCount && <span>{summaryQuery.data!.pending_answer_count}</span>}
      </div>
      <ul className="cc-request-slip">
        {groupRequests.map(request => <RequestCard
          key={request.id}
          request={request}
          callerId={me!.id}
          compactAnswered={heading === 'Answered for your things'}
        />)}
      </ul>
      {!groupRequests.length && <p className="cc-form-hint">{emptyMessage}{mayBeIncomplete ? ' This list may be incomplete.' : ''}</p>}
    </section>
  }

  return <main className="organic-requests">
    <h1>Requests</h1>
    {ownContactQuery.isSuccess && !ownContactQuery.data.contact && <aside className="cc-contact-nudge">
      <h2>Add how to reach you</h2>
      <p>The other person sees it after approval, while you're both active in that cache.</p>
      <Link to="/account">Add contact</Link>
    </aside>}
    {requestsQuery.isPending && <RequestsSkeleton embedded pendingAnswerCount={summaryQuery.isError ? undefined : summaryQuery.data?.pending_answer_count} />}
    {requestsQuery.isError && <div className="cc-read-error">
      <p role="alert">{errorMessage(requestsQuery.error)} Some requests may be unavailable.</p>
      <button type="button" disabled={requestsQuery.isFetching} onClick={() => void requestsQuery.refetch()}>Try requests again</button>
    </div>}
    {!!unavailableCaches.length && <div className="cc-read-error">
      <p role="alert">Requests from {unavailableCaches.length} cache(s) could not be loaded. These lists are incomplete.</p>
      <button type="button" disabled={requestsQuery.isFetching} onClick={() => void requestsQuery.refetch()}>Try unavailable caches again</button>
    </div>}
    {requestsQuery.data && <>
      <div className="cc-request-columns">
        <div className="cc-request-owned">
          {renderGroup('Needs your answer', incomingRequests, 'No asks need your answer in the loaded results.')}
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
