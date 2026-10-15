import { Link, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { pendingIncomingCount, useRequests } from '../lib/requests'

export function AppHeader() {
  const { me } = useAuth()
  const { pathname } = useLocation()
  const visible = !!me?.display_name && pathname !== '/login' && pathname !== '/auth/link'
  const requests = useRequests(visible)
  if (!visible || !me) return null
  // ponytail: first discovery page only; the full Requests page paginates the rest.
  const count = pendingIncomingCount(requests.data?.pages[0]?.requests ?? [], me.id)
  return <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
    <div className="mx-auto flex max-w-md items-center justify-between px-4 py-2.5">
      <Link to="/" className="text-[17px] font-bold tracking-tight">Communal Cache</Link>
      <nav aria-label="Main navigation" className="flex items-center gap-1.5">
        <Link to="/requests" aria-label="Requests" aria-describedby={count > 0 ? 'incoming-request-count' : undefined} aria-current={pathname === '/requests' ? 'page' : undefined} className={`relative flex size-[38px] items-center justify-center rounded-full border ${pathname === '/requests' ? 'border-slate-200 bg-slate-100' : 'border-transparent'}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
          {count > 0 && <span id="incoming-request-count" aria-label={`${count} pending incoming requests in the first page`} className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-red-700 px-[3px] text-center text-[11px] leading-4 font-semibold text-white">{count}</span>}
        </Link>
        <Link to="/account" aria-label="Account" aria-current={pathname === '/account' ? 'page' : undefined} className={`flex size-[38px] items-center justify-center rounded-full border ${pathname === '/account' ? 'border-slate-200 bg-slate-100' : 'border-transparent'}`}>
          <span aria-hidden="true" className="flex size-[30px] items-center justify-center rounded-full bg-slate-900 text-[13px] font-semibold text-white">{Array.from(me.display_name!.trim())[0]?.toUpperCase() ?? '?'}</span>
        </Link>
      </nav>
    </div>
  </header>
}
