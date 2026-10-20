import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/api'
import { libraryItemQuery, type Item } from '../lib/items'
import { SkeletonRows } from '../components/Skeleton'

export function ShownIn({ item }: { item: Item }) {
  const { me } = useAuth()
  const libraryItem = useQuery({ ...libraryItemQuery(me?.id, item.id), enabled: !!me?.display_name })
  const editPath = item.cache_id ? `/caches/${item.cache_id}/items/${item.id}/edit` : `/items/${item.id}/edit`
  return <section className="cc-owner-sharing" aria-labelledby="shown-in-heading">
    <h2 id="shown-in-heading" className="text-xl font-semibold">Shown in</h2>
    {libraryItem.isPending && <SkeletonRows label="Loading sharing…" kind="plain" count={2} />}
    {libraryItem.isError && <div className="mt-3">
      <p role="alert" className="cc-form-error">{errorMessage(libraryItem.error)}</p>
      <button type="button" className="cc-text-action" onClick={() => void libraryItem.refetch()}>Try sharing again</button>
    </div>}
    {libraryItem.isSuccess && <ul className="cc-cache-list">
      {libraryItem.data.caches.map(cache => <li key={cache.id}><Link to={`/caches/${cache.id}`}>{cache.name}</Link></li>)}
      {!libraryItem.data.caches.length && <li className="cc-list-empty">Not in any caches yet.</li>}
    </ul>}
    <p className="cc-form-hint"><Link to={editPath} state={{itemEditor:true}}>Edit item</Link> to change where it's shown.</p>
  </section>
}
