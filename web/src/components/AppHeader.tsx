import { Link, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { pendingIncomingCount, useRequests } from '../lib/requests'
import { AccountMenu } from './AccountMenu'

export function AppHeader() {
  const { me } = useAuth()
  const { pathname } = useLocation()
  const visible = !!me?.display_name && pathname !== '/login' && pathname !== '/auth/link'
  const requests = useRequests(visible)
  if (!visible || !me) return null
  // ponytail: first discovery page only; the full Requests page paginates the rest.
  const count = pendingIncomingCount(requests.data?.pages[0]?.requests ?? [], me.id)
  return <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
    <div className="mx-auto flex max-w-md items-center justify-between px-4 py-2.5 lg:h-[60px] lg:max-w-[1120px] lg:gap-7 lg:px-8 lg:py-0">
      <Link to="/" aria-label="Home" className="flex min-h-11 items-center gap-2.5">
        <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-[10px] bg-slate-900"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinejoin="round"><path d="M3 9.5 12 4l9 5.5v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M8 20v-6h8v6M8 14h8" /></svg></span>
        <span className="hidden lg:inline lg:text-[17px] lg:font-bold lg:tracking-tight">Communal Cache</span>
      </Link>
      <AccountMenu key={me.id} name={me.display_name!} count={count} />
    </div>
  </header>
}
