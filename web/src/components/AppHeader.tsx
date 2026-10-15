import { Link, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { pendingIncomingCount, useRequests } from '../lib/requests'
import { AccountMenu } from './AccountMenu'
import { BoxMark } from './PixelArt'

export function AppHeader() {
  const { me } = useAuth()
  const { pathname } = useLocation()
  const visible = !!me?.display_name && pathname !== '/login' && pathname !== '/auth/link'
  const requests = useRequests(visible)
  if (!visible || !me) return null
  // ponytail: first request page only; the full Requests page paginates the rest.
  const count = pendingIncomingCount(requests.data?.pages[0]?.requests ?? [], me.id)
  return <header className={`cc-app-header sticky top-0 z-20 border-b border-slate-200 ${pathname==='/' || /^\/caches\/[^/]+$/.test(pathname) ? 'cc-app-header-hero' : ''}`}>
    <div className="mx-auto flex max-w-md items-center justify-between px-4 py-2.5 lg:h-[60px] lg:max-w-[1120px] lg:gap-7 lg:px-8 lg:py-0">
      <Link to="/" aria-label="Home" className="flex min-h-11 items-center gap-2.5">
        <span aria-hidden="true" className="cc-home-mark flex size-9 items-center justify-center rounded-[10px]"><BoxMark /></span>
        <span className="hidden lg:inline lg:text-[17px] lg:font-bold lg:tracking-tight">Communal Cache</span>
      </Link>
      <AccountMenu key={me.id} name={me.display_name!} count={count} />
    </div>
  </header>
}
