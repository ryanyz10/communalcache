import { useRef } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, errorMessage } from '../lib/api'
import { itemKeys, type Item } from '../lib/items'
import { invalidateRequestViews, requestKeys } from '../lib/requests'
import { useToast } from '../components/Toast'
import { transientActionFailure } from '../lib/feedback'

export function DeleteItem({ item, disabled = false, onBusy }: {item:Item;disabled?:boolean;onBusy?:(busy:boolean)=>void}) {
  const { showToast } = useToast()
  const dialog = useRef<HTMLDialogElement>(null)
  const client = useQueryClient()
  const navigate = useNavigate()
  const deletion = useMutation({
    mutationFn: () => apiFetch<void>(`/api/me/items/${item.id}`,{method:'DELETE'}),
    onMutate: () => onBusy?.(true),
    onSuccess: async () => {
      dialog.current?.close()
      navigate('/items',{replace:true})
      client.removeQueries({queryKey:itemKeys.detailPrefix()})
      client.removeQueries({queryKey:itemKeys.libraryItemPrefix()})
      client.removeQueries({queryKey:requestKeys.itemPrefix()})
      await invalidateRequestViews(client)
      showToast('Item deleted.')
    },
    onError: error => { if (transientActionFailure(error)) showToast(errorMessage(error),'error') },
    onSettled: () => onBusy?.(false),
  })
  return <>
    <button type="button" className="cc-delete-item" disabled={disabled || deletion.isPending} onClick={() => {deletion.reset();dialog.current?.showModal()}}>Delete item</button>
    <dialog ref={dialog} className="cc-item-confirm" aria-labelledby="delete-item-heading" onCancel={event => {event.stopPropagation();if(deletion.isPending)event.preventDefault()}}>
      <h2 id="delete-item-heading">Delete {item.title} everywhere?</h2>
      <ul>
        <li>This permanently removes the item from your library and every cache.</li>
        <li>Its request history is erased. Neighbors with pending requests will be notified.</li>
        <li>Its private photos are queued for cleanup.</li>
      </ul>
      {deletion.isError && !transientActionFailure(deletion.error) && <p role="alert" className="cc-form-error">{errorMessage(deletion.error)}</p>}
      <div className="cc-inline-actions">
        <button type="button" autoFocus disabled={deletion.isPending} className="cc-profile-secondary" onClick={() => dialog.current?.close()}>Cancel</button>
        <button type="button" disabled={deletion.isPending} className="cc-profile-primary" onClick={() => deletion.mutate()}>{deletion.isPending ? 'Deleting…' : 'Confirm deletion'}</button>
      </div>
    </dialog>
  </>
}
