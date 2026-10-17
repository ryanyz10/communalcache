import { useState } from 'react'
import { Link,Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch,errorMessage } from '../lib/api'
import { libraryItemQuery,type Item } from '../lib/items'
import { relativeWhen,stockAfterApproval,useRequests,type ItemRequest } from '../lib/requests'
import { useHomeSummary } from '../lib/caches'
import { useOwnContact } from '../lib/contacts'
import { RequestStatus } from '../components/RequestStatus'
import { Stamp } from '../components/Stamp'
import { Avatar } from '../components/Avatar'
import { OnboardingPage } from './OnboardingPage'
import { RequestDecision } from './RequestDecision'
import { ApprovedContact } from './RequestContact'
import { AskSheet } from './AskSheet'
import { RequestsSkeleton } from '../components/PageSkeletons'
import { SkeletonRows, Shimmer, LoadingStatus } from '../components/Skeleton'
export { ApprovedContact } from './RequestContact'

function OwnerStock({request,callerId}:{request:ItemRequest;callerId:string}) {
  const query=useQuery({...libraryItemQuery(callerId,request.item_id),enabled:request.owner_id===callerId && request.status==='pending' && request.quantity!==null})
  if(query.isPending)return <span className="cc-skeleton-inline"><LoadingStatus label="Checking stock…" /><Shimmer width={90} height={12} /></span>
  if(query.isError)return <span> · stock unavailable <button type="button" className="cc-stock-retry" onClick={()=>void query.refetch()}>Retry stock</button></span>
  if(query.data.owner_id!==callerId || typeof query.data.quantity!=='number' || request.quantity===null)return null
  const left=stockAfterApproval(query.data.quantity,request.quantity)
  return <span> · {left>=0?`${left} left after this`:'not enough stock to approve'}</span>
}

export function RequestCard({request,callerId,compactAnswered=false}:{request:ItemRequest;callerId:string;compactAnswered?:boolean}) {
  const incoming=request.owner_id===callerId,party=incoming || request.requester_id===callerId,pendingIncoming=incoming && request.status==='pending'
  const answered=incoming && request.status!=='pending',compact=answered && compactAnswered
  const personId=incoming?request.requester_id:request.owner_id,name=(incoming?request.requester_name:request.owner_name) ?? 'Member'
  const version=incoming?request.requester_photo_version:request.owner_photo_version,coat=incoming?request.requester_cat_coat:request.owner_cat_coat
  const itemLink=`/caches/${request.cache_id}/items/${request.item_id}`
  const time=request.status==='approved' && !incoming?`approved ${request.decided_at && Date.now()-request.decided_at<86_400_000?'today':relativeWhen(request.decided_at ?? request.created_at)}`
    :request.status==='pending' && !incoming?`asked ${relativeWhen(request.created_at)}`:relativeWhen(request.decided_at ?? request.created_at)
  return <li className={`cc-request-card${pendingIncoming?' cc-request-card-incoming':''}${compact || (!incoming && request.status!=='approved')?' cc-request-card-compact':''}`}>
    <div className="cc-request-person-row"><Avatar userId={personId} name={name} photoVersion={version} coat={coat} size={compact || (!incoming && request.status!=='approved')?34:40} /><div className="cc-request-copy">
      <p>{pendingIncoming?<><b>{name}</b> {request.quantity===null?'asked to use your ':`asked for ${request.quantity} `}<Link to={itemLink}><b>{request.item_title}</b></Link></>:incoming?<><b>{name}</b> · <Link to={itemLink}>{request.item_title}</Link></>:<><Link to={itemLink}><b>{request.item_title}</b></Link> from {name}</>}</p>
      <p className="cc-request-meta">{request.status==='rejected'?`Reason: ${request.decision_reason ?? 'Declined'}`:<>{request.cache_name} · {time}{pendingIncoming && request.quantity!==null && <OwnerStock request={request} callerId={callerId} />}</>}</p>
    </div>{!pendingIncoming && (request.status==='approved' && party?<Link to={`/requests/${request.id}`} aria-label={`Approved ask for ${request.item_title}: view handoff details`} className="cc-approved-detail-link"><RequestStatus status={request.status} /></Link>:<RequestStatus status={request.status} />)}</div>
    {request.status==='approved' && party && !compact && <>
      {request.approval_message && <p className="cc-private-note">{request.approval_message}</p>}
      <div className="cc-card-contact"><ApprovedContact request={request} callerId={callerId} /></div>
    </>}
    {pendingIncoming && <RequestDecision request={request} />}
  </li>
}

export function ItemRequests({item,compact=false,askOpen=false,onAskClose,cacheName}:{item:Item;compact?:boolean;askOpen?:boolean;onAskClose?:()=>void;cacheName?:string}) {
  const {me}=useAuth(),[localAsk,setLocalAsk]=useState(false)
  const query=useQuery({queryKey:['item-requests',item.cache_id,item.id],queryFn:()=>apiFetch<ItemRequest[]>(`/api/caches/${item.cache_id}/items/${item.id}/requests`),enabled:!!me?.display_name})
  return <section className={compact?'cc-detail-requests':'cc-item-requests'} aria-labelledby="requests-heading">
    <div className="cc-detail-requests-title"><h2 id="requests-heading">Asks</h2><p>Pending asks are visible to the cache. Decisions stay between the two people.</p></div>
    {query.isPending && <SkeletonRows label="Loading requests…" kind="requests" count={2} />}
    {query.isError && <div><p role="alert" className="cc-form-error">{errorMessage(query.error)}</p><button type="button" className="cc-text-action" disabled={query.isFetching} onClick={()=>void query.refetch()}>Try requests again</button></div>}
    {query.isSuccess && <>
      {!compact && item.is_consumable && item.available_quantity!==undefined && <p>Available now: {item.available_quantity}</p>}
      {!compact && item.is_consumable && (item.available_quantity===undefined || item.available_quantity===null) && <p className="cc-form-hint">Refresh the item to see current availability.</p>}
      {!compact && item.is_consumable && typeof item.available_quantity==='number' && item.available_quantity<=0 && <p className="cc-form-hint">No stock available now.</p>}
      {item.available===false && <p className="cc-form-hint">Lent out{item.unavailable_note?` · ${item.unavailable_note}`:''}. Existing requests can still be decided.</p>}
      {!compact && me?.id!==item.owner_id && <button type="button" className="cc-profile-primary" aria-haspopup="dialog" onClick={()=>setLocalAsk(true)} disabled={item.available===false || (item.is_consumable && (item.available_quantity ?? 0)<=0)}>{item.is_consumable?'Ask for some':'Ask to borrow'}</button>}
      <ul className={compact?'cc-detail-ask-list':'cc-request-slip'}>{query.data.map(request=>compact && request.status==='pending' && me?.id!==item.owner_id
        ? <li key={request.id} className="cc-pending-ask-row"><Avatar userId={request.requester_id} name={request.requester_name ?? 'Member'} coat={request.requester_cat_coat} photoVersion={request.requester_photo_version} size={30} /><span><b>{request.requester_name ?? 'Member'}</b> asked {relativeWhen(request.created_at)}{request.quantity!==null?` for ${request.quantity}`:''}</span><Stamp>Pending</Stamp></li>
        :<RequestCard key={request.id} request={request} callerId={me?.id ?? ''} />)}</ul>
      {!query.data.length && <p className="cc-form-hint">No visible requests for this item yet.</p>}
    </>}
    {(compact?askOpen:localAsk) && me?.id!==item.owner_id && <AskSheet item={item} cacheName={cacheName} onClose={()=>{setLocalAsk(false);onAskClose?.()}} />}
    {!compact && <Link to="/requests" className="cc-text-action">Your incoming and outgoing requests</Link>}
  </section>
}

export function RequestsPage() {
  const {me}=useAuth(),query=useRequests(!!me?.display_name),summary=useHomeSummary(!!me?.display_name),ownContact=useOwnContact(me?.id ?? '')
  if(!me)return <Navigate to="/login" replace />
  if(!me.display_name)return <OnboardingPage />
  const requests=query.data?.pages.flatMap(page=>page.requests) ?? [],unavailable=query.data?.pages.flatMap(page=>page.unavailable_cache_ids) ?? []
  const incoming=requests.filter(row=>row.owner_id===me.id && row.status==='pending'),answered=requests.filter(row=>row.owner_id===me.id && row.status!=='pending'),outgoing=requests.filter(row=>row.requester_id===me.id)
  function group(heading:string,rows:ItemRequest[],empty:string) {
    return <section className="cc-request-group" aria-label={heading}><div className="cc-request-group-heading"><h2>{heading}</h2>{heading==='Needs your answer' && !summary.isError && !!summary.data?.pending_answer_count && <span>{summary.data.pending_answer_count}</span>}</div><ul className="cc-request-slip">{rows.map(request=><RequestCard key={request.id} request={request} callerId={me!.id} compactAnswered={heading==='Answered for your things'} />)}</ul>
      {!rows.length && <p className="cc-form-hint">{empty}{unavailable.length || query.isError || query.hasNextPage?' This list may be incomplete.':''}</p>}
    </section>
  }
  return <main className="organic-requests"><h1>Requests</h1>
    {ownContact.isSuccess && !ownContact.data.contact && <aside className="cc-contact-nudge"><h2>Add how to reach you</h2><p>The other person sees it after approval, while you're both active in that cache.</p><Link to="/account">Add contact</Link></aside>}
    {query.isPending && <RequestsSkeleton embedded pendingAnswerCount={summary.isError ? undefined : summary.data?.pending_answer_count} />}
    {query.isError && <div className="cc-read-error"><p role="alert">{errorMessage(query.error)} Some requests may be unavailable.</p><button type="button" disabled={query.isFetching} onClick={()=>void query.refetch()}>Try requests again</button></div>}
    {!!unavailable.length && <div className="cc-read-error"><p role="alert">Requests from {unavailable.length} cache(s) could not be loaded. These lists are incomplete.</p><button type="button" disabled={query.isFetching} onClick={()=>void query.refetch()}>Try unavailable caches again</button></div>}
    {query.data && <><div className="cc-request-columns"><div className="cc-request-owned">{group('Needs your answer',incoming,'No asks need your answer in the loaded results.')}{group('Answered for your things',answered,'No answered asks for your things in the loaded results.')}</div>{group('Your asks',outgoing,'None of your asks are visible in the loaded results.')}</div>
      {query.hasNextPage && <button type="button" className="cc-profile-secondary cc-request-more" disabled={query.isFetching} onClick={()=>void query.fetchNextPage()}>{query.isFetchingNextPage?<><LoadingStatus label="Loading more requests…" /><Shimmer width={140} height={18} /></>:'Load more requests'}</button>}</>}
  </main>
}
