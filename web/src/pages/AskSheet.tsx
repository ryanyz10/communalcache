import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, errorMessage } from '../lib/api'
import type { Item } from '../lib/items'
import { invalidateRequestViews, type ItemRequest } from '../lib/requests'
import { Cat } from '../components/Cat'
import { LoadingLines } from '../components/Skeleton'

export function AskSheet({ item, cacheName = 'This cache', onClose }: {
  item: Item
  cacheName?: string
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const client = useQueryClient()
  const [quantity, setQuantity] = useState('1')
  const currentItemQuery = useQuery({
    queryKey: ['item', item.cache_id, item.id],
    queryFn: () => apiFetch<Item>(`/api/caches/${item.cache_id}/items/${item.id}`),
    enabled: !!item.cache_id,
  })
  const currentItem = currentItemQuery.data ?? item
  const availableQuantity = currentItem.is_consumable ? currentItem.available_quantity : null
  const validQuantity = !currentItem.is_consumable || (
    quantity !== '' && Number.isInteger(Number(quantity)) && Number(quantity) >= 1 &&
    typeof availableQuantity === 'number' && Number(quantity) <= Math.min(9999, availableQuantity)
  )
  const available = currentItem.available !== false && (
    !currentItem.is_consumable || (typeof availableQuantity === 'number' && availableQuantity > 0)
  )
  const askMutation = useMutation({
    mutationFn: () => apiFetch<ItemRequest>(`/api/caches/${item.cache_id}/items/${item.id}/requests`, {
      body: { quantity: currentItem.is_consumable ? Number(quantity) : null },
    }),
    onSettled: () => invalidateRequestViews(client),
  })
  useEffect(() => {
    // Native dialog focus runs after React's initial autofocus pass.
    if (cancelRef.current) cancelRef.current.autofocus = true
    dialogRef.current?.showModal()
  }, [])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!validQuantity || !available || currentItemQuery.isFetching || currentItemQuery.isError || askMutation.isPending) return
    askMutation.mutate()
  }

  const ownerName = currentItem.owner_name ?? 'the owner'
  const heading = currentItem.is_consumable ? `Ask ${ownerName} for some?` : `Ask ${ownerName} to borrow it?`

  return <dialog
    id="item-ask-sheet"
    ref={dialogRef}
    className="cc-action-sheet cc-ask-sheet"
    aria-labelledby="ask-sheet-heading"
    onClose={onClose}
    onCancel={event => { if (askMutation.isPending) event.preventDefault() }}
  >
    <span className="cc-sheet-person cc-sheet-person-left" aria-hidden="true">
      <Cat userId={item.owner_id} coat={item.owner_cat_coat} pose="peek" />
    </span>
    {askMutation.isSuccess ? <div className="cc-action-sheet-body">
      <div className="cc-sheet-heading">
        <h2 id="ask-sheet-heading">Ask sent</h2>
        <p>{item.title} · {cacheName}</p>
      </div>
      <p role="status">Request sent. Arrange the handoff in person if approved.</p>
      <button type="button" autoFocus className="cc-profile-primary" onClick={() => dialogRef.current?.close()}>Done</button>
    </div> : <form className="cc-action-sheet-body" onSubmit={submit}>
      <div className="cc-sheet-heading">
        <h2 id="ask-sheet-heading">{heading}</h2>
        <p>{cacheName}{currentItem.is_consumable && typeof availableQuantity === 'number' && !currentItemQuery.isError ? ` · ${availableQuantity} to give right now` : ''}</p>
      </div>
      {currentItem.is_consumable && <div className="cc-ask-stepper">
        <label htmlFor="request-quantity">How many?</label>
        <button
          type="button"
          aria-label="Decrease ask quantity"
          disabled={askMutation.isPending || Number(quantity) <= 1}
          onClick={() => setQuantity(String(Math.max(1, Number(quantity) - 1)))}
        >−</button>
        <input
          id="request-quantity"
          type="number"
          inputMode="numeric"
          min={1}
          max={typeof availableQuantity === 'number' ? Math.min(9999, availableQuantity) : 0}
          step={1}
          required
          value={quantity}
          disabled={askMutation.isPending || !available || currentItemQuery.isError}
          onChange={event => setQuantity(event.target.value)}
          style={{ width: `${Math.max(1, quantity.length)}ch` }}
        />
        <button
          type="button"
          aria-label="Increase ask quantity"
          disabled={askMutation.isPending || typeof availableQuantity !== 'number' || Number(quantity) >= Math.min(9999, availableQuantity)}
          onClick={() => setQuantity(String(Math.min(availableQuantity ?? 0, Number(quantity) + 1)))}
        >+</button>
      </div>}
      {currentItemQuery.isFetching && <LoadingLines label="Checking current availability…" />}
      {currentItemQuery.isError && <div>
        <p role="alert" className="cc-form-error">{errorMessage(currentItemQuery.error)}</p>
        <button type="button" className="cc-text-action" onClick={() => void currentItemQuery.refetch()}>Refresh availability</button>
      </div>}
      {!currentItemQuery.isError && currentItem.available === false && <p className="cc-form-hint">This item is marked as lent out. Existing requests are unchanged.</p>}
      {!currentItemQuery.isError && currentItem.is_consumable && (availableQuantity === undefined || availableQuantity === null) && <p className="cc-form-hint">Refresh the item to see current availability.</p>}
      {!currentItemQuery.isError && currentItem.is_consumable && typeof availableQuantity === 'number' && availableQuantity <= 0 && <p className="cc-form-hint">No stock available now.</p>}
      <p className="cc-ask-privacy">If {ownerName} says yes, you'll both see how to reach each other. The handoff happens in person.</p>
      {askMutation.isError && <p role="alert" className="cc-form-error">{errorMessage(askMutation.error)}</p>}
      <button
        type="submit"
        className="cc-profile-primary"
        disabled={askMutation.isPending || currentItemQuery.isFetching || currentItemQuery.isError || !validQuantity || !available}
      >{askMutation.isPending ? 'Sending ask…' : 'Send ask'}</button>
      <button ref={cancelRef} type="button" autoFocus className="cc-sheet-text-button" disabled={askMutation.isPending} onClick={() => dialogRef.current?.close()}>Cancel</button>
    </form>}
  </dialog>
}
