import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/api'
import { libraryItemQuery, itemKeys, persistItem, type Item, type LibraryItem, type ItemSaveProgress } from '../lib/items'
import { cacheListQuery } from '../lib/caches'
import { usePhotoSelection } from '../lib/usePhotoSelection'
import { PhotoPreview } from '../components/PhotoPreview'
import { invalidateRequestViews } from '../lib/requests'
import { LoadingStatus, Shimmer } from '../components/Skeleton'
import { useToast } from '../components/Toast'
import { transientActionFailure } from '../lib/feedback'
import { DeleteItem } from './DeleteItem'

export type ItemEditorState = { dirty: boolean; committed: boolean }

type ItemFormProps = {
  cacheId: string | null
  item?: Item
  onSaved: (item: Item, sharedInCurrentCache?: boolean) => void
  onCancel: () => void
  onBusy?: (busy: boolean) => void
  onStateChange?: (state: ItemEditorState) => void
}

export function ItemForm({ cacheId, item, onSaved, onCancel, onBusy, onStateChange }: ItemFormProps) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { me } = useAuth()
  const [title, setTitle] = useState(item?.title ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [isConsumable, setIsConsumable] = useState(item?.is_consumable ?? false)
  const [active, setActive] = useState(item?.active !== false)
  const [quantityText, setQuantityText] = useState(String(item?.quantity ?? 1))
  const photo = usePhotoSelection()
  const [removePhotoVersion, setRemovePhotoVersion] = useState<string | null>(null)
  const savedPhoto = item?.photo_version && !removePhotoVersion ? `/api/me/items/${item.id}/photo?v=${encodeURIComponent(item.photo_version)}` : null
  const photoPreview = photo.preview ?? savedPhoto
  const hasPhotoDraft = !!photo.photo || photo.processing || !!photo.error
  const photoInput = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const detachDialog = useRef<HTMLDialogElement>(null)
  const knownCacheNames = useRef<Record<string,string>>({})
  useLayoutEffect(() => {
    heading.current?.setAttribute('data-initial-focus','true')
    heading.current?.focus()
  }, [])
  const [selectedCacheIds, setSelectedCacheIds] = useState<string[] | null>(null)
  const saveProgress = useRef<ItemSaveProgress>({ item: null, remainingCacheIds: [], remainingDetachIds: [], failedCacheId: null, photoPending: false, stage: 'saving' })
  const [saveSnapshot, setSaveSnapshot] = useState<ItemSaveProgress | null>(null)
  const cachesQuery = useQuery({
    ...cacheListQuery(),
    enabled: !!me?.display_name,
  })
  const libraryItem = useQuery({ ...libraryItemQuery(me?.id, item?.id ?? ''), enabled: !!item && !!me?.display_name })
  const initialCacheIds = libraryItem.data?.caches.map(cache => cache.id) ?? []
  const cacheIds = selectedCacheIds ?? (item ? initialCacheIds : cacheId ? [cacheId] : [])
  const cacheNames = { ...knownCacheNames.current, ...Object.fromEntries([...(libraryItem.data?.caches ?? []),...(cachesQuery.data ?? [])].map(cache => [cache.id,cache.name])) }
  const removed = item ? (libraryItem.data?.caches.filter(cache => !cacheIds.includes(cache.id)) ?? []) : []
  const deactivating = !!item && item.active !== false && !active
  const waitingCount = libraryItem.data?.pending_count ?? 0
  const confirmDeactivation = deactivating && waitingCount > 0
  // A committed retry uses its saved plan, not a new diff from a failed metadata refresh.
  const sharingReady = !item || !!saveProgress.current.item || (libraryItem.isSuccess && cachesQuery.isSuccess)
  const saveItem = useMutation({
    mutationFn: async () => {
      knownCacheNames.current = cacheNames
      if (!saveProgress.current.item) setSelectedCacheIds(cacheIds)
      const pendingPhoto = !saveProgress.current.item || saveProgress.current.photoPending ? photo.photo : null
      const itemChanges = {
        title,
        description: description.trim() || null,
        quantity: isConsumable ? Number(quantityText) : null,
        ...(!item ? { is_consumable: isConsumable } : {}),
        ...(!item || active !== (item.active !== false) ? { active } : {}),
      }
      return persistItem(saveProgress.current, {
        cacheId,
        itemId: item?.id,
        cacheIds,
        initialCacheIds: item ? initialCacheIds : undefined,
        photo: pendingPhoto,
        removePhotoVersion,
        body: itemChanges,
      }, () => setSaveSnapshot({ ...saveProgress.current }), (id,shared) => {
        queryClient.setQueryData<LibraryItem>(itemKeys.libraryItem(me?.id, saveProgress.current.item!.id), current => {
          if (!current) return current
          const otherCaches = current.caches.filter(cache => cache.id !== id)
          return { ...current, caches: shared ? [...otherCaches,{id,name:cacheNames[id]}] : otherCaches }
        })
      })
    },
    onSuccess: persisted => {
      detachDialog.current?.close()
      showToast(item ? 'Item saved.' : 'Item added.')
      onSaved(persisted, persisted.active !== false && !!cacheId && cacheIds.includes(cacheId))
    },
    onError: error => {
      const failedId = saveProgress.current.failedCacheId
      if (failedId) showToast(`Couldn't save sharing for ${cacheNames[failedId] ?? 'selected cache'}. ${errorMessage(error)}`, 'error')
      else if (transientActionFailure(error)) showToast(errorMessage(error), 'error')
    },
    onSettled: async () => {
      onBusy?.(false)
      await invalidateRequestViews(queryClient)
    },
  })

  function save() {
    if (submitDisabled) return
    onBusy?.(true)
    saveItem.mutate()
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (submitDisabled) return
    if (!saveProgress.current.item && (removed.length || confirmDeactivation)) detachDialog.current?.showModal()
    else save()
  }

  const hasCommittedItem = !!saveSnapshot?.item
  const fieldsLocked = saveItem.isPending || hasCommittedItem
  const savedIds = item ? initialCacheIds : cacheId ? [cacheId] : []
  const selectionChanged = cacheIds.length !== savedIds.length || cacheIds.some(id => !savedIds.includes(id))
  const dirty = title !== (item?.title ?? '') || description !== (item?.description ?? '') ||
    isConsumable !== (item?.is_consumable ?? false) || active !== (item?.active !== false) || quantityText !== String(item?.quantity ?? 1) ||
    selectionChanged || hasPhotoDraft || !!removePhotoVersion || hasCommittedItem
  useEffect(() => { onStateChange?.({ dirty, committed: hasCommittedItem }) }, [dirty, hasCommittedItem, onStateChange])
  const quantity = Number(quantityText)
  const validQuantity = !isConsumable || (
    quantityText !== '' && Number.isInteger(quantity) && quantity >= 0 && quantity <= 9999
  )
  const submitDisabled = saveItem.isPending || photo.processing || !!photo.error || !title.trim() || !validQuantity || !sharingReady
  let submitLabel = 'Save'
  if (saveSnapshot?.item) submitLabel = saveSnapshot.photoPending ? 'Retry photo' : 'Retry sharing'
  const failedCacheId = saveSnapshot?.failedCacheId
  const saveError = `${failedCacheId ? `Couldn't save sharing for ${cacheNames[failedCacheId] ?? 'selected cache'}. ` : ''}${errorMessage(saveItem.error)}`
  const removalsToConfirm = saveSnapshot?.item
    ? saveSnapshot.remainingDetachIds.map(id => ({id,name:cacheNames[id] ?? 'selected cache'})) : removed
  const orderedCaches = cachesQuery.data && [...cachesQuery.data].sort((a, b) =>
    Number(cacheIds.includes(b.id)) - Number(cacheIds.includes(a.id)),
  )

  let recoveryAction: ReactNode
  if (saveSnapshot?.photoPending) {
    recoveryAction = <button type="button" disabled={saveItem.isPending} className="cc-profile-secondary" onClick={() => {
      saveProgress.current.photoPending = false
      saveProgress.current.removePhotoVersion = null
      onBusy?.(true)
      saveItem.mutate()
    }}>{item ? 'Keep current photo' : 'Continue without photo'}</button>
  } else if (saveSnapshot?.item && (saveSnapshot.remainingCacheIds.length || saveSnapshot.remainingDetachIds.length)) {
    recoveryAction = <button
      type="button"
      disabled={saveItem.isPending}
      className="cc-profile-secondary"
      onClick={() => {
        const stillShared = !!cacheId && (item ? initialCacheIds.includes(cacheId) && !saveSnapshot.remainingDetachIds.includes(cacheId) : true)
        onSaved(saveSnapshot.item!, saveSnapshot.item!.active !== false && stillShared)
      }}
    >{item ? 'Keep item with current sharing' : 'Keep item without remaining shares'}</button>
  }

  return <form className="cc-item-form" onSubmit={submit}>
    <div className="cc-item-editor-header">
      <button type="button" className="cc-item-editor-phone" disabled={saveItem.isPending} onClick={onCancel}>Cancel</button>
      <h2 ref={heading} id="item-editor-heading" tabIndex={-1}>{item ? 'Edit item' : 'New item'}</h2>
      <button type="submit" className="cc-item-editor-phone" disabled={submitDisabled}>{saveItem.isPending ? 'Saving…' : submitLabel}</button>
      <button type="button" className="cc-item-editor-close" aria-label="Close" disabled={saveItem.isPending} onClick={onCancel}>×</button>
    </div>
    <div className="cc-item-editor-body">
    <fieldset disabled={fieldsLocked} className="cc-item-fields">
      <div className="cc-item-editor-top">
      <ItemPhotoField photoPreview={photoPreview} hasPhotoDraft={hasPhotoDraft} fieldsLocked={fieldsLocked}
        photoInput={photoInput} processing={photo.processing} error={photo.error}
        onSelect={photo.select} onRemove={() => {
          if (hasPhotoDraft) photo.clear()
          else setRemovePhotoVersion(item?.photo_version ?? null)
          if (photoInput.current) photoInput.current.value = ''
        }} />
      <ItemDetailsFields item={item} title={title} description={description} isConsumable={isConsumable}
        quantityText={quantityText} onTitleChange={setTitle} onDescriptionChange={setDescription}
        onKindChange={setIsConsumable} onQuantityChange={setQuantityText} />
      </div>
      <ItemCacheSharing item={item} cacheId={cacheId} cacheIds={cacheIds} caches={orderedCaches}
        loading={cachesQuery.isPending || (!!item && libraryItem.isPending)}
        isError={cachesQuery.isError || (!!item && libraryItem.isError)} error={cachesQuery.error ?? libraryItem.error}
        empty={cachesQuery.isSuccess && !cachesQuery.data.length} fieldsLocked={fieldsLocked} sharingReady={sharingReady}
        onRetry={() => { void cachesQuery.refetch(); if (item) void libraryItem.refetch() }}
        onToggle={id => setSelectedCacheIds(current => {
          const ids = current ?? cacheIds
          return ids.includes(id) ? ids.filter(cacheId => cacheId !== id) : [...ids,id]
        })} />
      <ItemActiveToggle active={active} fieldsLocked={fieldsLocked} onChange={setActive} />
    </fieldset>
    {item && <div className="cc-item-editor-delete"><DeleteItem item={item} disabled={fieldsLocked} onBusy={onBusy} /></div>}
    {saveSnapshot?.item && saveItem.isError && <div className="cc-item-save-progress" role="status">
      <p>Your item is saved{!item && cacheId ? ' and shared here' : ' in your library'}. {saveSnapshot.photoPending ? 'The photo needs retrying.' : 'Sharing needs retrying.'}</p>
      {!!saveSnapshot.remainingCacheIds.length && <p>
        Still to share in: {saveSnapshot.remainingCacheIds.map(id => cachesQuery.data?.find(cache => cache.id === id)?.name ?? 'selected cache').join(', ')}. Already shared caches are kept.
      </p>}
      {!!saveSnapshot.remainingDetachIds.length && <p>Still to stop sharing in: {saveSnapshot.remainingDetachIds.map(id => cacheNames[id] ?? 'selected cache').join(', ')}. Successful changes are kept.</p>}
    </div>}
    {saveItem.isError && (!!failedCacheId || !transientActionFailure(saveItem.error)) && <p role="alert" className="cc-form-error">{saveError}</p>}
    {saveItem.isError && recoveryAction && <div className="cc-item-recovery-actions">{recoveryAction}</div>}
    </div>
    <div className="cc-item-editor-desktop-actions">
      <button type="button" disabled={saveItem.isPending} onClick={onCancel} className="cc-profile-secondary">Cancel</button>
      <button type="submit" disabled={submitDisabled} className="cc-profile-primary">{saveItem.isPending ? 'Saving…' : submitLabel}</button>
    </div>
    <ItemSharingConfirmation dialogRef={detachDialog} confirmDeactivation={confirmDeactivation} title={title}
      cacheNames={libraryItem.data?.caches.map(cache => cache.name).join(' and ') || 'all attached caches'}
      waitingCount={waitingCount} removalsToConfirm={removalsToConfirm} isPending={saveItem.isPending}
      isError={saveItem.isError} saveError={saveError} submitDisabled={submitDisabled} onSave={save}
      onKeepActive={() => setActive(true)} />
  </form>
}

function ItemPhotoField({ photoPreview, hasPhotoDraft, fieldsLocked, photoInput, processing, error, onSelect, onRemove }: {
  photoPreview: string | null
  hasPhotoDraft: boolean
  fieldsLocked: boolean
  photoInput: RefObject<HTMLInputElement | null>
  processing: boolean
  error: string
  onSelect: (file: File | null) => Promise<void>
  onRemove: () => void
}) {
  return <div className="cc-item-photo-field">
    <div className="cc-item-photo-slot">
      <label className="cc-photo-picker" htmlFor="new-item-photo">
        <PhotoPreview src={photoPreview} alt="Selected item photo preview" />
        <span className={photoPreview ? 'sr-only' : undefined}>{photoPreview ? 'Replace photo' : 'Add a photo'}</span>
        <input ref={photoInput} id="new-item-photo" type="file" accept="image/*" disabled={fieldsLocked} onChange={event => void onSelect(event.target.files?.[0] ?? null)} />
      </label>
      {(photoPreview || hasPhotoDraft) && <button type="button" className="cc-item-photo-remove" disabled={fieldsLocked} aria-label={hasPhotoDraft ? 'Remove selected photo' : 'Remove saved photo'} onClick={onRemove}>×</button>}
    </div>
    {photoPreview && <p className="cc-item-photo-caption"><span className="cc-phone-copy">Tap the photo to replace</span><span className="cc-desktop-copy">Click to replace</span></p>}
    {processing && <p role="status">Preparing photo…</p>}
    {error && <p role="alert" className="cc-form-error">{error}</p>}
  </div>
}

function ItemDetailsFields({ item, title, description, isConsumable, quantityText, onTitleChange, onDescriptionChange, onKindChange, onQuantityChange }: {
  item?: Item
  title: string
  description: string
  isConsumable: boolean
  quantityText: string
  onTitleChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onKindChange: (value: boolean) => void
  onQuantityChange: (value: string) => void
}) {
  return <div className="cc-item-editor-copy">
    {!item && <fieldset className="cc-item-kind-tabs">
      <legend className="sr-only">How would you like to share it?</legend>
      <label><input type="radio" name="item-type" checked={!isConsumable} onChange={() => onKindChange(false)} /><span>Lend it</span></label>
      <label><input type="radio" name="item-type" checked={isConsumable} onChange={() => onKindChange(true)} /><span>Give it away</span></label>
    </fieldset>}
    <div className="cc-item-title-field">
      <label htmlFor="item-title">What is it?{item && <> · {isConsumable ? 'Give' : 'Lend'}</>}</label>
      <input
        id="item-title"
        type="text"
        required
        maxLength={240}
        value={title}
        onChange={event => onTitleChange([...event.target.value].slice(0, 120).join(''))}
        className="cc-profile-input"
      />
    </div>
    <div className="cc-item-note-field">
      <label htmlFor="item-description">Note (optional)</label>
      <textarea
        id="item-description"
        rows={3}
        maxLength={4000}
        value={description}
        onChange={event => onDescriptionChange([...event.target.value].slice(0, 2000).join(''))}
        className="cc-profile-input"
      />
    </div>
    {isConsumable && <ItemStockField quantityText={quantityText} onChange={onQuantityChange} />}
  </div>
}

function ItemStockField({ quantityText, onChange }: { quantityText: string; onChange: (value: string) => void }) {
  const quantity = Number(quantityText)
  return <div className="cc-stock-stepper">
    <label htmlFor="item-quantity">How many to give?</label>
    <button type="button" aria-label="Decrease stock quantity" disabled={quantity <= 0} onClick={() => onChange(String(Math.max(0, quantity - 1)))}>−</button>
    <input
      id="item-quantity"
      aria-describedby="quantity-help"
      type="number"
      inputMode="numeric"
      required
      min={0}
      max={9999}
      step={1}
      value={quantityText}
      style={{ width: `${Math.max(1, quantityText.length)}ch` }}
      onChange={event => onChange(event.target.value)}
    />
    <button type="button" aria-label="Increase stock quantity" disabled={quantity >= 9999} onClick={() => onChange(String(Math.min(9999, quantity + 1)))}>+</button>
    <span id="quantity-help" className="sr-only">Stock quantity 0–9999. One stock count across all caches; pending requests must stay covered.</span>
  </div>
}

function ItemCacheSharing({ item, cacheId, cacheIds, caches, loading, isError, error, empty, fieldsLocked, sharingReady, onRetry, onToggle }: {
  item?: Item
  cacheId: string | null
  cacheIds: string[]
  caches: { id: string; name: string }[] | undefined
  loading: boolean
  isError: boolean
  error: unknown
  empty: boolean
  fieldsLocked: boolean
  sharingReady: boolean
  onRetry: () => void
  onToggle: (id: string) => void
}) {
  return <fieldset className="cc-put-it-in">
    <legend>Put it in</legend>
    {loading && <div className="cc-skeleton-cache-options">
      <LoadingStatus label="Loading caches…" /><Shimmer width={130} height={38} /><Shimmer width={110} height={38} />
    </div>}
    {isError && <div className="cc-read-error">
      <p role="alert">{errorMessage(error)}</p>
      <button type="button" onClick={onRetry}>Try caches again</button>
    </div>}
    <div className="cc-select-options">
      {caches && caches.map(cache => {
        const isSelected = cacheIds.includes(cache.id)
        return <button
          key={cache.id}
          type="button"
          className="cc-select-pill"
          aria-pressed={isSelected}
          disabled={(!item && cache.id === cacheId) || fieldsLocked || !sharingReady}
          onClick={() => onToggle(cache.id)}
        >
          {cache.name}
          {!item && cache.id === cacheId && <span className="sr-only">, shared here in the same create operation</span>}
        </button>
      })}
      {empty && <p className="cc-list-empty">No caches yet. Your item stays private in your library.</p>}
    </div>
  </fieldset>
}

function ItemActiveToggle({ active, fieldsLocked, onChange }: { active: boolean; fieldsLocked: boolean; onChange: (value: boolean) => void }) {
  return <label className="cc-item-active">
    <span><strong>{active ? 'Active' : 'Inactive'}</strong><span id="item-active-help">{active ? 'Item is shown in all attached caches' : 'Item is hidden from all caches'}</span></span>
    <input id="item-active" type="checkbox" role="switch" aria-label={active ? 'Active' : 'Inactive'} aria-describedby="item-active-help" checked={active} disabled={fieldsLocked} onChange={event => onChange(event.target.checked)} className="cc-switch" />
  </label>
}

function ItemSharingConfirmation({ dialogRef, confirmDeactivation, title, cacheNames, waitingCount, removalsToConfirm, isPending, isError, saveError, submitDisabled, onSave, onKeepActive }: {
  dialogRef: RefObject<HTMLDialogElement | null>
  confirmDeactivation: boolean
  title: string
  cacheNames: string
  waitingCount: number
  removalsToConfirm: { id: string; name: string }[]
  isPending: boolean
  isError: boolean
  saveError: string
  submitDisabled: boolean
  onSave: () => void
  onKeepActive: () => void
}) {
  return <dialog ref={dialogRef} className={`cc-item-confirm${confirmDeactivation ? ' cc-item-deactivate' : ''}`} aria-labelledby="detach-item-heading" onCancel={event => {
    event.stopPropagation()
    if (isPending) event.preventDefault()
    else if (confirmDeactivation) onKeepActive()
  }}>
    <h2 id="detach-item-heading">{confirmDeactivation ? `Make ${title} inactive?` : 'Stop sharing in these caches?'}</h2>
    {confirmDeactivation && <p>It disappears from {cacheNames}. <strong>{waitingCount} waiting {waitingCount === 1 ? 'request will' : 'requests will'} be declined.</strong></p>}
    {(!confirmDeactivation || !!removalsToConfirm.length) && <>
      <ul>{removalsToConfirm.map(cache => <li key={cache.id}>{cache.name}</li>)}</ul>
      <ul>
        <li>The item is removed from these caches only. Added caches are saved first.</li>
        <li>Pending asks in these caches get declined and requesters are notified.</li>
        <li>Your library item, photos, stock and other caches are kept.</li>
      </ul>
    </>}
    {isError && <p role="alert" className="cc-form-error">{saveError} Successful changes are kept. You can retry here.</p>}
    <div className="cc-inline-actions">
      <button type="button" autoFocus disabled={isPending} className="cc-profile-secondary" onClick={() => { if (confirmDeactivation) onKeepActive(); dialogRef.current?.close() }}>{confirmDeactivation ? 'Keep active' : 'Cancel'}</button>
      <button type="button" disabled={submitDisabled} className="cc-profile-primary" onClick={onSave}>{isPending ? 'Saving…' : confirmDeactivation ? 'Make inactive' : 'Confirm stop sharing'}</button>
    </div>
  </dialog>
}
