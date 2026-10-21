import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/api'
import type { Item } from '../lib/items'
import { ordinal, useRequests } from '../lib/requests'
import { Avatar } from '../components/Avatar'
import { LoadingStatus } from '../components/Skeleton'
import { RequestDecision } from './RequestDecision'

export function ItemWaiting({ item, pendingCount = 0 }: {item:Item;pendingCount?:number}) {
  const { me } = useAuth()
  const isOwner=!!me?.display_name && me.id===item.owner_id
  const query=useRequests(isOwner,'incoming',item.id)
  const requests=query.data?.pages.flatMap(page=>page.requests) ?? []
  if (!isOwner || (query.isPending && !pendingCount) || (query.isSuccess && !requests.length && !query.hasNextPage)) return null
  const total=query.hasNextPage ? Math.max(pendingCount,requests.length) : query.isSuccess ? requests.length : pendingCount
  return <aside className="cc-owner-waiting" aria-labelledby="item-waiting-heading">
    <h2 id="item-waiting-heading">Waiting · {total}</h2>
    {query.isPending && <LoadingStatus label="Loading waiting requests…" />}
    {query.isError && <div className="cc-read-error">
      <p role="alert">{errorMessage(query.error)}</p>
      <button type="button" className="cc-text-action" disabled={query.isFetching} onClick={() => void query.refetch()}>Try waiting requests again</button>
    </div>}
    {!!requests.length && <ul className="cc-item-wait-list">{requests.map(request => <li key={request.id} className="cc-item-wait-row">
      <Avatar userId={request.requester_id} name={request.requester_name ?? 'Member'} coat={request.requester_cat_coat} photoVersion={request.requester_photo_version} size={32} />
      <div className="cc-item-wait-person">
        <p className="cc-item-wait-identity"><strong>{request.requester_name ?? 'Member'}</strong><span className="cc-item-wait-cache" title={request.cache_name}>· {request.cache_name}</span></p>
        <span>{request.queue_position===1 ? 'Next up' : request.queue_position ? ordinal(request.queue_position) : 'Waiting'}{request.quantity !== null ? ` · ${request.quantity} requested` : ''}</span>
      </div>
      <RequestDecision request={request} />
    </li>)}</ul>}
    {query.hasNextPage && <button type="button" className="cc-text-action" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading waiting requests…' : 'Load more waiting requests'}</button>}
  </aside>
}
