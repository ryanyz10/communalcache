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
    <div className="mx-auto flex max-w-md items-center justify-between px-4 py-2.5 lg:h-[60px] lg:max-w-[1120px] lg:gap-7 lg:px-8 lg:py-0">
      <Link to="/" className="text-[17px] font-bold tracking-tight lg:flex lg:shrink-0 lg:items-center lg:gap-2.5"><span aria-hidden="true" className="hidden lg:flex lg:size-9 lg:items-center lg:justify-center lg:rounded-[10px] lg:bg-slate-900"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinejoin="round"><path d="M3 9.5 12 4l9 5.5v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M8 20v-6h8v6M8 14h8" /></svg></span>Communal Cache</Link>
      <nav aria-label="Desktop navigation" className="hidden lg:flex lg:flex-1 lg:gap-1">
        <Link to="/" aria-current={pathname === '/' || pathname.startsWith('/caches/') ? 'page' : undefined} className={`lg:rounded-lg lg:px-3 lg:py-1.5 lg:font-medium ${pathname === '/' || pathname.startsWith('/caches/') ? 'lg:bg-slate-100 lg:text-slate-900' : 'lg:text-slate-700'}`}>Caches</Link>
        <Link to="/requests" aria-current={pathname === '/requests' ? 'page' : undefined} className={`lg:flex lg:items-center lg:gap-1.5 lg:rounded-lg lg:px-3 lg:py-1.5 lg:font-medium ${pathname === '/requests' ? 'lg:bg-slate-100 lg:text-slate-900' : 'lg:text-slate-700'}`}>Requests{count > 0 && <span aria-label={`${count} pending incoming requests on the first page`} className="lg:min-w-[18px] lg:rounded-full lg:bg-red-700 lg:px-[5px] lg:text-center lg:text-[11px] lg:leading-[18px] lg:font-semibold lg:text-white">{count}</span>}</Link>
      </nav>
      <Link to="/account" aria-current={pathname === '/account' ? 'page' : undefined} className="hidden lg:flex lg:items-center lg:gap-2 lg:font-medium"><span aria-hidden="true" className="lg:flex lg:size-[30px] lg:items-center lg:justify-center lg:rounded-full lg:bg-slate-900 lg:text-[13px] lg:font-semibold lg:text-white">{Array.from(me.display_name!.trim())[0]?.toUpperCase() ?? '?'}</span>{me.display_name}</Link>
      <nav aria-label="Main navigation" className="flex items-center gap-1.5 lg:hidden">
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
