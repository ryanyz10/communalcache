import { useEffect,useRef,useState,type FormEvent } from 'react'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { apiFetch,errorMessage } from '../lib/api'
import type { Item } from '../lib/items'
import { invalidateRequestViews,type ItemRequest } from '../lib/requests'
import { Cat } from '../components/Cat'

export function AskSheet({item,cacheName='This cache',onClose}:{item:Item;cacheName?:string;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),client=useQueryClient()
  const [quantity,setQuantity]=useState('1')
  const current=useQuery({queryKey:['item',item.cache_id,item.id],queryFn:()=>apiFetch<Item>(`/api/caches/${item.cache_id}/items/${item.id}`),enabled:!!item.cache_id})
  const stock=current.data ?? item,max=stock.is_consumable?stock.available_quantity:null
  const validQuantity=!stock.is_consumable || (quantity!=='' && Number.isInteger(Number(quantity)) && Number(quantity)>=1 && typeof max==='number' && Number(quantity)<=Math.min(9999,max))
  const available=stock.available!==false && (!stock.is_consumable || (typeof max==='number' && max>0))
  const ask=useMutation({mutationFn:()=>apiFetch<ItemRequest>(`/api/caches/${item.cache_id}/items/${item.id}/requests`,{body:{quantity:stock.is_consumable?Number(quantity):null}}),onSettled:()=>invalidateRequestViews(client)})
  useEffect(()=>{
    // Native dialog focus runs after React's initial autofocus pass.
    if(cancel.current)cancel.current.autofocus=true
    dialog.current?.showModal()
  },[])
  function submit(event:FormEvent) {event.preventDefault();if(validQuantity && available && !current.isFetching && !current.isError && !ask.isPending)ask.mutate()}
  const name=stock.owner_name ?? 'the owner'
  return <dialog id="item-ask-sheet" ref={dialog} className="cc-action-sheet cc-ask-sheet" aria-labelledby="ask-sheet-heading" onClose={onClose} onCancel={event=>{if(ask.isPending)event.preventDefault()}}>
    <span className="cc-sheet-person cc-sheet-person-left" aria-hidden="true"><Cat userId={item.owner_id} coat={item.owner_cat_coat} pose="peek" /></span>
    {ask.isSuccess ? <div className="cc-action-sheet-body"><div className="cc-sheet-heading"><h2 id="ask-sheet-heading">Ask sent</h2><p>{item.title} · {cacheName}</p></div><p role="status">Request sent. Arrange the handoff in person if approved.</p><button type="button" autoFocus className="cc-profile-primary" onClick={()=>dialog.current?.close()}>Done</button></div> : <form className="cc-action-sheet-body" onSubmit={submit}>
      <div className="cc-sheet-heading"><h2 id="ask-sheet-heading">{stock.is_consumable?`Ask ${name} for some?`:`Ask ${name} to borrow it?`}</h2><p>{cacheName}{stock.is_consumable && typeof max==='number' && !current.isError?` · ${max} to give right now`:''}</p></div>
      {stock.is_consumable && <div className="cc-ask-stepper"><label htmlFor="request-quantity">How many?</label><button type="button" aria-label="Decrease ask quantity" disabled={ask.isPending || Number(quantity)<=1} onClick={()=>setQuantity(String(Math.max(1,Number(quantity)-1)))}>−</button><input id="request-quantity" type="number" inputMode="numeric" min={1} max={typeof max==='number'?Math.min(9999,max):0} step={1} required value={quantity} disabled={ask.isPending || !available || current.isError} onChange={event=>setQuantity(event.target.value)} style={{width:`${Math.max(1,quantity.length)}ch`}} /><button type="button" aria-label="Increase ask quantity" disabled={ask.isPending || typeof max!=='number' || Number(quantity)>=Math.min(9999,max)} onClick={()=>setQuantity(String(Math.min(max ?? 0,Number(quantity)+1)))}>+</button></div>}
      {current.isFetching && <p role="status" className="cc-form-hint">Checking current availability…</p>}
      {current.isError && <div><p role="alert" className="cc-form-error">{errorMessage(current.error)}</p><button type="button" className="cc-text-action" onClick={()=>void current.refetch()}>Refresh availability</button></div>}
      {!current.isError && stock.available===false && <p className="cc-form-hint">This item is marked as lent out. Existing requests are unchanged.</p>}
      {!current.isError && stock.is_consumable && (max===undefined || max===null) && <p className="cc-form-hint">Refresh the item to see current availability.</p>}
      {!current.isError && stock.is_consumable && typeof max==='number' && max<=0 && <p className="cc-form-hint">No stock available now.</p>}
      <p className="cc-ask-privacy">If {name} says yes, you'll both see how to reach each other. The handoff happens in person.</p>
      {ask.isError && <p role="alert" className="cc-form-error">{errorMessage(ask.error)}</p>}
      <button type="submit" className="cc-profile-primary" disabled={ask.isPending || current.isFetching || current.isError || !validQuantity || !available}>{ask.isPending?'Sending ask…':'Send ask'}</button><button ref={cancel} type="button" autoFocus className="cc-sheet-text-button" disabled={ask.isPending} onClick={()=>dialog.current?.close()}>Cancel</button>
    </form>}
  </dialog>
}
