import { useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useProfile } from '../auth/AuthProvider'
import { errorMessage } from '../lib/api'
import { cacheDetailQuery } from '../lib/caches'
import { cacheItemQuery, libraryItemQuery, type Item } from '../lib/items'
import { ItemForm, type ItemEditorState } from './ItemForm'
import { ItemPage } from './ItemPage'
import { LibraryPage } from './LibraryPage'
import { CachePage } from './CachePage'
import { ItemEditorDialog } from '../components/ItemEditorDialog'
import { LoadingStatus } from '../components/Skeleton'

export function ItemEditorPage({ editing = false }: { editing?: boolean }) {
  const { cacheId, itemId = '' } = useParams()
  const me = useProfile()
  const navigate = useNavigate()
  const location = useLocation()
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<ItemEditorState>({ dirty: false, committed: false })
  const cacheQuery = useQuery({ ...cacheDetailQuery(cacheId), enabled: !!cacheId && !!me.display_name })
  const itemQuery = useQuery<Item>({
    ...(cacheId ? cacheItemQuery(cacheId, itemId) : libraryItemQuery(me.id, itemId)),
    enabled: editing && !!me.display_name && !state.committed,
  })
  const backPath = cacheId ? `/caches/${cacheId}` : '/items'

  if (editing && itemQuery.isSuccess && itemQuery.data.owner_id !== me.id) return <Navigate to={backPath} replace />

  // A committed deactivation hides the cache route; keep its save continuation mounted.
  const readError = state.committed ? null : (cacheId ? cacheQuery.error : null) ?? (editing ? itemQuery.error : null)
  const isLoading = !state.committed && ((!!cacheId && cacheQuery.isPending) || (editing && itemQuery.isPending))
  const cancelPath = editing ? (cacheId ? `/caches/${cacheId}/items/${itemId}` : `/items/${itemId}`) : backPath
  const formKey = editing ? itemId : `new:${cacheId ?? 'library'}`
  function close() {
    if (location.state?.itemEditor === true) navigate(-1)
    else navigate(cancelPath, { replace: true })
  }

  return <>
    {editing ? <ItemPage /> : cacheId ? <CachePage /> : <LibraryPage />}
    <ItemEditorDialog key={formKey} onDismiss={close} busy={busy} dirty={state.dirty} committed={state.committed} returnFocus={editing ? itemId : 'new'}>
      {dismiss => isLoading || readError ? <div className="cc-item-editor-state">
        <h2 id="item-editor-heading" tabIndex={-1}>{editing ? 'Edit item' : 'New item'}</h2>
        {readError ? <>
          <p role="alert" className="cc-form-error">{errorMessage(readError)}</p>
          <button type="button" className="cc-profile-primary" onClick={() => {
            if (cacheId) void cacheQuery.refetch()
            if (editing) void itemQuery.refetch()
          }}>Try again</button>
        </> : <LoadingStatus label="Loading item editor…" />}
        <button type="button" className="cc-profile-secondary" onClick={dismiss}>Cancel</button>
      </div> : <ItemForm
        key={formKey}
        cacheId={cacheId ?? null}
        item={editing ? itemQuery.data : undefined}
        onSaved={(saved, sharedInCurrentCache = true) => navigate(cacheId && sharedInCurrentCache && saved.active !== false ? `/caches/${cacheId}/items/${saved.id}` : `/items/${saved.id}`, { replace: true })}
        onCancel={dismiss}
        onBusy={setBusy}
        onStateChange={setState}
      />}
    </ItemEditorDialog>
  </>
}
