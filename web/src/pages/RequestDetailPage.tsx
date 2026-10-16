import { Link,Navigate,useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch,errorMessage } from '../lib/api'
import type { ItemRequest } from '../lib/requests'
import { Cat } from '../components/Cat'
import { Avatar } from '../components/Avatar'
import { Stamp } from '../components/Stamp'
import { thingTone } from '../components/ThingTile'
import { OnboardingPage } from './OnboardingPage'
import { ApprovedContact } from './RequestContact'
import { RequestCard } from './RequestsPage'
import { RequestDetailSkeleton } from '../components/PageSkeletons'

export function RequestDetailPage() {
  const {requestId=''}=useParams(),{me}=useAuth()
  const query=useQuery({queryKey:['request-detail',me?.id,requestId],queryFn:()=>apiFetch<ItemRequest>(`/api/me/requests/${requestId}`),enabled:!!me?.display_name})
  if(!me)return <Navigate to="/login" replace />
  if(!me.display_name)return <OnboardingPage />
  return <main className="organic-request-detail"><nav className="cc-request-back"><Link to="/requests"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>Requests</Link></nav>
    {query.isPending && <RequestDetailSkeleton embedded />}
    {query.isError && <div className="cc-request-detail-state"><p role="alert" className="cc-form-error">{errorMessage(query.error)}</p><button type="button" className="cc-text-action" onClick={()=>void query.refetch()}>Try ask again</button></div>}
    {query.isSuccess && (query.data.status==='approved' ? <>
      <div className="cc-approved-item"><span className="cc-approved-cats" aria-hidden="true"><span><Cat userId={query.data.owner_id} coat={query.data.owner_cat_coat} pose="sit" /></span><span><Cat userId={query.data.requester_id} coat={query.data.requester_cat_coat} pose="sit" /></span></span>
        <div className={`cc-approved-name-tile cc-thing-tile-${thingTone(query.data.item_id)}`}><span className="cc-approved-name-art" aria-hidden="true">{query.data.item_title.toLocaleLowerCase().split(/\s+/).at(-1)}</span><Stamp tone="ok">Approved</Stamp></div>
      </div>
      <div className="cc-approved-copy"><div className="cc-approved-heading"><h1>{me.id===query.data.owner_id?`You said yes to ${query.data.requester_name ?? 'a neighbor'}`:`${query.data.owner_name ?? 'The owner'} said yes`}</h1><p>{query.data.item_title} · {query.data.cache_name}</p></div>
        {query.data.approval_message && <div className="cc-approved-note"><Avatar userId={query.data.owner_id} name={query.data.owner_name ?? 'Member'} coat={query.data.owner_cat_coat} photoVersion={query.data.owner_photo_version} size={30} /><p>{query.data.approval_message}</p></div>}
        <ApprovedContact request={query.data} callerId={me.id} focused />
      </div>
      <p className="cc-approved-handoff">Hand it off in person. Nothing else to do here.</p>
    </> : <div className="cc-request-detail-state"><h1>{query.data.status==='pending'?'Waiting for an answer':'Ask declined'}</h1><ul className="cc-request-slip"><RequestCard request={query.data} callerId={me.id} /></ul></div>)}
  </main>
}
