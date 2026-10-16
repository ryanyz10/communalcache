import type { ItemRequest } from '../lib/requests'
import { Stamp } from './Stamp'

export function RequestStatus({ status }: { status: ItemRequest['status'] }) {
  return <span className={`cc-request-status cc-request-status-${status}`}><Stamp tone={status==='approved'?'ok':'muted'}>{status==='pending'?'Waiting':status==='approved'?'Approved':'Declined'}</Stamp></span>
}
