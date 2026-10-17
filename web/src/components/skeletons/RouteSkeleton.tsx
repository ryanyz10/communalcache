import { HomeSkeleton } from './HomeSkeleton'
import { CacheSkeleton, CacheSettingsSkeleton } from './CacheSkeleton'
import { LibrarySkeleton } from './LibrarySkeleton'
import { ItemSkeleton, ItemEditorSkeleton } from './ItemSkeletons'
import { RequestsSkeleton, RequestDetailSkeleton } from './RequestSkeletons'
import { AccountSkeleton } from './AccountSkeleton'

export function RouteSkeleton({ pathname }: { pathname: string }) {
  const cacheId = pathname.match(/^\/caches\/([^/]+)/)?.[1]
  if (/\/items\/(?:new|[^/]+\/edit)$/.test(pathname)) {
    return <ItemEditorSkeleton editing={pathname.endsWith('/edit')} />
  }
  if (/\/items\/[^/]+$/.test(pathname)) return <ItemSkeleton cacheId={cacheId} />
  if (cacheId) {
    if (pathname.endsWith('/settings')) return <CacheSettingsSkeleton cacheId={cacheId} />
    return <CacheSkeleton cacheId={cacheId} />
  }
  if (pathname === '/items') return <LibrarySkeleton />
  if (pathname.startsWith('/requests/')) return <RequestDetailSkeleton />
  if (pathname === '/requests') return <RequestsSkeleton />
  if (pathname === '/account') return <AccountSkeleton />
  return <HomeSkeleton />
}
