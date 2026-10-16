import { Link, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { pendingIncomingCount, useRequests } from '../lib/requests'
import { Avatar } from './Avatar'
import { BoxMark } from './Box'
import { Tabs } from './Tabs'

export function AppHeader() {
  const { me } = useAuth()
  const { pathname } = useLocation()
  const visible = !!me?.display_name && pathname !== '/login' && pathname !== '/auth/link' && !pathname.startsWith('/join/')
  const requests = useRequests(visible)
  if (!visible || !me) return null
  // ponytail: first page only until the summary API lands with the Home redesign.
  const count = pendingIncomingCount(requests.data?.pages[0]?.requests ?? [], me.id)
  const identity = { count, userId: me.id, name: me.display_name!, photoVersion: me.profile_photo_version, coat: me.cat_coat }
  return <>
    <header className={`cc-app-header${pathname === '/' ? ' cc-app-header-home' : ''}`}>
      <div className="cc-header-content">
        <Link to="/" aria-label="Home" className="cc-brand"><BoxMark /><span>Communal Cache</span></Link>
        <Tabs {...identity} />
        <Link to="/account" aria-label="Account" aria-current={pathname === '/account' ? 'page' : undefined} className="cc-account-link">
          <Avatar userId={me.id} name={me.display_name!} photoVersion={me.profile_photo_version} coat={me.cat_coat} size={38} />
        </Link>
      </div>
    </header>
    <Tabs {...identity} mobile />
  </>
}
