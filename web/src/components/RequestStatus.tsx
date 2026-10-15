import type { ItemRequest } from '../lib/requests'

export function RequestStatus({ status }: { status: ItemRequest['status'] }) {
  const color = status === 'pending' ? 'border-amber-200 bg-amber-100 text-amber-800' : status === 'approved' ? 'border-green-200 bg-green-100 text-green-800' : 'border-slate-200 bg-slate-100 text-slate-700'
  return <span className={`inline-block shrink-0 rounded-full border px-2 py-px text-xs leading-[18px] ${color}`}>{status === 'pending' ? 'Pending' : status === 'approved' ? 'Approved' : 'Rejected'}</span>
}
