import type { ItemRequest } from '../lib/requests'
import { Stamp } from './Stamp'

export function RequestStatus({ status }: { status: ItemRequest['status'] }) {
  const tone = status === 'approved' ? 'ok' : 'muted'
  let label = 'Declined'
  if (status === 'pending') label = 'Waiting'
  else if (status === 'approved') label = 'Approved'
  return <span className={`cc-request-status cc-request-status-${status}`}><Stamp tone={tone}>{label}</Stamp></span>
}
