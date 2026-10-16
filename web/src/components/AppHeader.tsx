import { Link, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { useHomeSummary } from '../lib/caches'
import { Avatar } from './Avatar'
import { BoxMark } from './Box'
import { Tabs } from './Tabs'
import { Shimmer } from './Skeleton'

export function AppHeader({ loading = false }: { loading?: boolean }) {
  const { me } = useAuth()
  const { pathname } = useLocation()
  const visible = (loading || !!me?.display_name) && pathname !== '/login' && pathname !== '/auth/link' && !pathname.startsWith('/join/')
  const summary = useHomeSummary(visible && !!me?.display_name)
  if (!visible) return null
  const count = summary.isError ? 0 : summary.data?.pending_answer_count ?? 0
  const identity = { count, userId: me?.id, name: me?.display_name ?? undefined, photoVersion: me?.profile_photo_version, coat: me?.cat_coat }
  return <>
    <header className={`cc-app-header${pathname === '/' ? ' cc-app-header-home' : ''}`}>
      <div className="cc-header-content">
        <Link to="/" aria-label="Home" className="cc-brand"><BoxMark /><span>Communal Cache</span></Link>
        <Tabs {...identity} />
        <Link to="/account" aria-label="Account" aria-current={pathname === '/account' ? 'page' : undefined} className="cc-account-link">
          {me ? <Avatar userId={me.id} name={me.display_name!} photoVersion={me.profile_photo_version} coat={me.cat_coat} size={38} /> : <Shimmer width={38} height={38} round />}
        </Link>
      </div>
    </header>
    {!/^\/(?:caches\/[^/]+\/)?items\/.+/.test(pathname) && !pathname.startsWith('/requests/') && <Tabs {...identity} mobile />}
  </>
}
