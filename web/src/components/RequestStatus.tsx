import type { ItemRequest } from '../lib/requests'
import { Stamp } from './Stamp'

export function RequestStatus({ status }: { status: ItemRequest['status'] }) {
  return <Stamp tone={status === 'approved' ? 'ok' : status === 'pending' ? 'warn' : 'muted'}>{status === 'pending' ? 'Pending' : status === 'approved' ? 'Approved' : 'Rejected'}</Stamp>
}
