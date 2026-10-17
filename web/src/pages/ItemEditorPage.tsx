import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import { cacheDetailQuery } from '../lib/caches'
import { libraryItemQuery, type Item } from '../lib/items'
import { OnboardingPage } from './OnboardingPage'
import { ItemForm } from './ItemForm'
import { ItemEditorSkeleton } from '../components/skeletons/ItemSkeletons'

export function ItemEditorPage({ editing = false }: { editing?: boolean }) {
  const { cacheId, itemId = '' } = useParams()
  const { me } = useAuth()
  const navigate = useNavigate()
  const cacheQuery = useQuery({ ...cacheDetailQuery(cacheId), enabled: !!cacheId && !!me?.display_name })
  const itemQuery = useQuery<Item>({
    ...(cacheId ? {
      queryKey: ['item', cacheId, itemId],
      queryFn: () => apiFetch<Item>(`/api/caches/${cacheId}/items/${itemId}`),
    } : libraryItemQuery(me?.id, itemId)),
    enabled: editing && !!me?.display_name,
  })
  const backPath = cacheId ? `/caches/${cacheId}` : '/items'

  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  if (editing && itemQuery.isSuccess && itemQuery.data.owner_id !== me.id) return <Navigate to={backPath} replace />

  const readError = (cacheId ? cacheQuery.error : null) ?? (editing ? itemQuery.error : null)
  const isLoading = (!!cacheId && cacheQuery.isPending) || (editing && itemQuery.isPending)
  if (isLoading && !readError) return <ItemEditorSkeleton editing={editing} />

  let cancelPath = backPath
  if (editing) cancelPath = cacheId ? `/caches/${cacheId}/items/${itemId}` : `/items/${itemId}`

  return <main className="organic-item-editor">
    {readError && <div>
      <p role="alert" className="cc-form-error">{errorMessage(readError)}</p>
      <button className="cc-text-action" onClick={() => {
        if (cacheId) void cacheQuery.refetch()
        if (editing) void itemQuery.refetch()
      }}>Try again</button>
      <Link to={backPath}>Cancel</Link>
    </div>}
    {!isLoading && !readError && <ItemForm
      key={editing ? itemId : `new:${cacheId ?? 'library'}`}
      cacheId={cacheId ?? null}
      item={editing ? itemQuery.data : undefined}
      onSaved={saved => navigate(cacheId ? `/caches/${cacheId}/items/${saved.id}` : `/items/${saved.id}`)}
      onCancel={() => navigate(cancelPath)}
    />}
  </main>
}
