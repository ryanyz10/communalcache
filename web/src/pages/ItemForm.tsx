import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import { persistItem, type Item, type ItemSaveProgress } from '../lib/items'
import type { CacheSummary } from '../lib/caches'
import { usePhotoSelection } from '../lib/usePhotoSelection'
import { PhotoPreview } from '../components/PhotoPreview'
import { invalidateRequestViews } from '../lib/requests'
import { LoadingStatus, Shimmer } from '../components/Skeleton'
import { useToast } from '../components/Toast'
import { transientActionFailure } from '../lib/feedback'

export type ItemEditorState = { dirty: boolean; committed: boolean }

type ItemFormProps = {
  cacheId: string | null
  item?: Item
  onSaved: (item: Item) => void
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
  const [quantityText, setQuantityText] = useState(String(item?.quantity ?? 1))
  const photo = usePhotoSelection()
  const photoInput = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [])
  const [selectedCacheIds, setSelectedCacheIds] = useState<string[]>(cacheId ? [cacheId] : [])
  const saveProgress = useRef<ItemSaveProgress>({ item: null, remainingCacheIds: [], photoPending: false, stage: 'saving' })
  const [saveSnapshot, setSaveSnapshot] = useState<ItemSaveProgress | null>(null)
  const cachesQuery = useQuery({
    queryKey: ['caches'],
    queryFn: () => apiFetch<CacheSummary[]>('/api/caches'),
    enabled: !item && !!me?.display_name,
  })
  const saveItem = useMutation({
    mutationFn: async () => {
      const pendingPhoto = !saveProgress.current.item || saveProgress.current.photoPending ? photo.photo : null
      const itemChanges = {
        title,
        description: description.trim() || null,
        quantity: isConsumable ? Number(quantityText) : null,
        ...(!item ? { is_consumable: isConsumable } : {}),
      }
      return persistItem(saveProgress.current, {
        cacheId,
        itemId: item?.id,
        cacheIds: selectedCacheIds,
        photo: pendingPhoto,
        body: itemChanges,
      }, () => setSaveSnapshot({ ...saveProgress.current }))
    },
    onSuccess: persisted => { showToast(item ? 'Item saved.' : 'Item added.'); onSaved(persisted) },
    onError: error => { if (transientActionFailure(error)) showToast(errorMessage(error), 'error') },
    onSettled: async () => {
      onBusy?.(false)
      await invalidateRequestViews(queryClient)
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (photo.processing || photo.error) return
    onBusy?.(true)
    saveItem.mutate()
  }

  const hasCommittedItem = !!saveSnapshot?.item
  const fieldsLocked = saveItem.isPending || hasCommittedItem
  const selectionChanged = !item && (selectedCacheIds.length !== (cacheId ? 1 : 0) || (!!cacheId && !selectedCacheIds.includes(cacheId)))
  const dirty = title !== (item?.title ?? '') || description !== (item?.description ?? '') ||
    isConsumable !== (item?.is_consumable ?? false) || quantityText !== String(item?.quantity ?? 1) ||
    selectionChanged || !!photo.photo || photo.processing || !!photo.error || hasCommittedItem
  useEffect(() => { onStateChange?.({ dirty, committed: hasCommittedItem }) }, [dirty, hasCommittedItem, onStateChange])
  const quantity = Number(quantityText)
  const validQuantity = !isConsumable || (
    quantityText !== '' && Number.isInteger(quantity) && quantity >= 0 && quantity <= 9999
  )
  const submitDisabled = saveItem.isPending || photo.processing || !!photo.error || !title.trim() || !validQuantity
  let submitLabel = 'Save'
  if (saveSnapshot?.item) submitLabel = saveSnapshot.photoPending ? 'Retry photo' : 'Retry sharing'
  const saveError = errorMessage(saveItem.error)
  const orderedCaches = cachesQuery.data && [...cachesQuery.data].sort((a, b) =>
    Number(selectedCacheIds.includes(b.id)) - Number(selectedCacheIds.includes(a.id)),
  )

  let recoveryAction: ReactNode
  if (saveSnapshot?.photoPending) {
    recoveryAction = <button type="button" disabled={saveItem.isPending} className="cc-profile-secondary" onClick={() => {
      saveProgress.current.photoPending = false
      onBusy?.(true)
      saveItem.mutate()
    }}>Continue without photo</button>
  } else if (saveSnapshot?.item && saveSnapshot.remainingCacheIds.length) {
    recoveryAction = <button
      type="button"
      disabled={saveItem.isPending}
      className="cc-profile-secondary"
      onClick={() => onSaved(saveSnapshot.item!)}
    >Keep item without remaining shares</button>
  }

  return <form className="cc-item-form" onSubmit={submit}>
    <div className="cc-item-editor-header">
      <button type="button" className="cc-item-editor-phone" disabled={saveItem.isPending} onClick={onCancel}>Cancel</button>
      <h2 ref={heading} id="item-editor-heading" tabIndex={-1}>{item ? 'Edit item' : 'New item'}</h2>
      <button type="submit" className="cc-item-editor-phone" disabled={submitDisabled}>{saveItem.isPending ? 'Saving…' : submitLabel}</button>
    </div>
    <div className="cc-item-editor-body">
    <fieldset disabled={fieldsLocked} className="cc-item-fields">
      {!item && <>
        <label className="cc-photo-picker" htmlFor="new-item-photo">
          <PhotoPreview src={photo.preview} alt="Selected item photo preview" />
          <strong>{photo.preview ? 'Replace selected photo' : 'Add a photo'}</strong>
          <span>Camera or library · optional</span>
          <input ref={photoInput} id="new-item-photo" type="file" accept="image/*" onChange={event => void photo.select(event.target.files?.[0] ?? null)} />
        </label>
        {(photo.photo || photo.processing || photo.error) && <button type="button" className="cc-profile-secondary" onClick={() => {
          photo.clear()
          if (photoInput.current) photoInput.current.value = ''
        }}>Remove selected photo</button>}
        {photo.processing && <p role="status">Preparing photo…</p>}
        {photo.error && <p role="alert" className="cc-form-error">{photo.error}</p>}
      </>}
      {item ? <p className="cc-form-hint">
        {isConsumable ? 'Give it away' : 'Lend it'} · Item type cannot be changed.
      </p> : <fieldset className="cc-item-kind-tabs">
        <legend className="sr-only">How would you like to share it?</legend>
        <label><input type="radio" name="item-type" checked={!isConsumable} onChange={() => setIsConsumable(false)} /><span>Lend it</span></label>
        <label><input type="radio" name="item-type" checked={isConsumable} onChange={() => setIsConsumable(true)} /><span>Give it away</span></label>
      </fieldset>}
      <div className="cc-item-title-field">
        <label htmlFor="item-title">What is it?</label>
        <input
          id="item-title"
          type="text"
          required
          maxLength={240}
          value={title}
          onChange={event => setTitle([...event.target.value].slice(0, 120).join(''))}
          className="cc-profile-input"
        />
      </div>
      {isConsumable && <div className="cc-stock-stepper">
        <label htmlFor="item-quantity">How many to give?</label>
        <button type="button" aria-label="Decrease stock quantity" disabled={quantity <= 0} onClick={() => setQuantityText(String(Math.max(0, quantity - 1)))}>−</button>
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
          onChange={event => setQuantityText(event.target.value)}
        />
        <button type="button" aria-label="Increase stock quantity" disabled={quantity >= 9999} onClick={() => setQuantityText(String(Math.min(9999, quantity + 1)))}>+</button>
        <span id="quantity-help" className="sr-only">Stock quantity 0–9999. One stock count across all caches; pending requests must stay covered.</span>
      </div>}
      {!item && <fieldset className="cc-put-it-in">
        <legend>Put it in</legend>
        {cachesQuery.isPending && <div className="cc-skeleton-cache-options">
          <LoadingStatus label="Loading caches…" /><Shimmer width={130} height={38} /><Shimmer width={110} height={38} />
        </div>}
        {cachesQuery.isError && <div className="cc-read-error">
          <p role="alert">{errorMessage(cachesQuery.error)}</p>
          <button type="button" onClick={() => void cachesQuery.refetch()}>Try caches again</button>
        </div>}
        <div className="cc-select-options">
          {orderedCaches && orderedCaches.map(cache => {
            const isSelected = selectedCacheIds.includes(cache.id)
            return <button
              key={cache.id}
              type="button"
              className="cc-select-pill"
              aria-pressed={isSelected}
              disabled={cache.id === cacheId || fieldsLocked}
              onClick={() => setSelectedCacheIds(current => current.includes(cache.id)
                ? current.filter(id => id !== cache.id) : [...current, cache.id])}
            >
              {cache.name}
              {cache.id === cacheId && <span className="sr-only">, shared here in the same create operation</span>}
            </button>
          })}
          {cachesQuery.isSuccess && !cachesQuery.data.length && <p className="cc-list-empty">No caches yet. Your item stays private in your library.</p>}
        </div>
      </fieldset>}
      <details className="cc-item-description-editor" open={!!item?.description}>
        <summary>{description ? 'Edit note' : 'Add a note (optional)'}</summary>
        <label htmlFor="item-description">Description (optional)</label>
        <textarea
          id="item-description"
          rows={3}
          maxLength={4000}
          value={description}
          onChange={event => setDescription([...event.target.value].slice(0, 2000).join(''))}
          className="cc-profile-input"
        />
      </details>
    </fieldset>
    {saveSnapshot?.item && saveItem.isError && <div className="cc-item-save-progress" role="status">
      <p>Your item is saved{cacheId ? ' and shared here' : ' in your library'}. {saveSnapshot.photoPending ? 'The photo needs retrying.' : 'Sharing needs retrying.'}</p>
      {!!saveSnapshot.remainingCacheIds.length && <p>
        Still to share in: {saveSnapshot.remainingCacheIds.map(id => cachesQuery.data?.find(cache => cache.id === id)?.name ?? 'selected cache').join(', ')}. Already shared caches are kept.
      </p>}
    </div>}
    {saveItem.isError && !transientActionFailure(saveItem.error) && <p role="alert" className="cc-form-error">{saveError}</p>}
    {saveItem.isError && recoveryAction && <div className="cc-item-recovery-actions">{recoveryAction}</div>}
    </div>
    <div className="cc-item-editor-desktop-actions">
      <button type="button" disabled={saveItem.isPending} onClick={onCancel} className="cc-profile-secondary">Cancel</button>
      <button type="submit" disabled={submitDisabled} className="cc-profile-primary">{saveItem.isPending ? 'Saving…' : submitLabel}</button>
    </div>
  </form>
}
