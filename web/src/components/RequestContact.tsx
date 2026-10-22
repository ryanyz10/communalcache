import { useQuery } from '@tanstack/react-query'
import { contactAction, contactDisplayValue, contactOpenLabel, requestContactQuery } from '../lib/contacts'
import type { ItemRequest } from '../lib/requests'
import { LoadingLines } from '../components/Skeleton'

export function ApprovedContact({ request, callerId, focused = false }: {
  request: ItemRequest
  callerId: string
  focused?: boolean
}) {
  const isParty = callerId === request.owner_id || callerId === request.requester_id
  const contactQuery = useQuery({
    ...requestContactQuery(callerId, request.id),
    enabled: isParty && request.status === 'approved',
    retry: false,
    gcTime: 0,
  })
  const otherName = (callerId === request.owner_id ? request.requester_name : request.owner_name) ?? 'Member'
  if (!isParty || request.status !== 'approved') return null
  if (contactQuery.isPending || contactQuery.isFetching) {
    return <LoadingLines label="Loading contact…" className={focused ? 'cc-focused-contact' : 'cc-inline-contact'} />
  }
  if (contactQuery.isError) {
    return <div className="cc-contact-unavailable">
      <p>Contact is unavailable. Both people must still be active in this request's cache.</p>
      <button type="button" className="cc-text-action" onClick={() => void contactQuery.refetch()}>Try contact again</button>
    </div>
  }
  const contact = contactQuery.data.contact
  if (!contact) return <p className="cc-form-hint">{otherName} hasn't added a way to reach them yet.</p>

  const isExternal = contact.link.startsWith('https://')
  return <div className={focused ? 'cc-focused-contact' : 'cc-inline-contact'} data-contact-kind={contact.kind}>
    {focused && <h2>How to reach {otherName}</h2>}
    <div className="cc-contact-destination">
      <div>
        {!focused && <strong>{contactAction(contact.kind, otherName)}</strong>}
        <span>{contactDisplayValue(contact)}</span>
      </div>
      <a
        href={contact.link}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        aria-label={contactAction(contact.kind, otherName)}
      >{focused ? contactAction(contact.kind, otherName) : contactOpenLabel(contact.kind)}</a>
    </div>
    {focused && <p>Shown while you're both in {request.cache_name}.</p>}
  </div>
}
