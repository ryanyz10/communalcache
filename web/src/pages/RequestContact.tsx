import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { contactAction,contactDisplayValue,contactOpenLabel,type Contact } from '../lib/contacts'
import type { ItemRequest } from '../lib/requests'

export function ApprovedContact({request,callerId,focused=false}:{request:ItemRequest;callerId:string;focused?:boolean}) {
  const party=callerId===request.owner_id || callerId===request.requester_id
  const query=useQuery({queryKey:['request-contact',callerId,request.id],queryFn:()=>apiFetch<{contact:Contact|null}>(`/api/me/requests/${request.id}/contact`),enabled:party && request.status==='approved',retry:false,gcTime:0})
  const name=(callerId===request.owner_id?request.requester_name:request.owner_name) ?? 'Member'
  if(!party || request.status!=='approved')return null
  if(query.isPending || query.isFetching)return <p role="status" className="cc-form-hint">Loading contact…</p>
  if(query.isError)return <div className="cc-contact-unavailable"><p>Contact is unavailable. Both people must still be active in this request's cache.</p><button type="button" className="cc-text-action" onClick={()=>void query.refetch()}>Try contact again</button></div>
  const contact=query.data.contact
  if(!contact)return <p className="cc-form-hint">{name} hasn't added a way to reach them yet.</p>
  const external=contact.link.startsWith('https://')
  return <div className={focused?'cc-focused-contact':'cc-inline-contact'} data-contact-kind={contact.kind}>
    {focused && <h2>How to reach {name}</h2>}
    <div className="cc-contact-destination"><div>{!focused && <strong>{contactAction(contact.kind,name)}</strong>}<span>{contactDisplayValue(contact)}</span></div>
      <a href={contact.link} target={external?'_blank':undefined} rel={external?'noopener noreferrer':undefined} aria-label={contactAction(contact.kind,name)}>{focused?contactAction(contact.kind,name):contactOpenLabel(contact.kind)}</a>
    </div>
    {focused && <p>Shown while you're both in {request.cache_name}.</p>}
  </div>
}
