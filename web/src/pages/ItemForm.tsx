import { useRef,useState,type FormEvent } from 'react'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch,errorMessage } from '../lib/api'
import { persistItem,type Item,type ItemSaveProgress } from '../lib/items'
import type { CacheSummary } from '../lib/caches'
import { boxColor } from '../components/Box'
import { PHOTO_READ_ERROR,resizePhoto } from '../lib/photos'
import { invalidateRequestViews } from '../lib/requests'
import { LoadingStatus, Shimmer } from '../components/Skeleton'

export function ItemForm({ cacheId,item,onSaved,onCancel,onBusy,embedded=false }: {cacheId:string|null;item?:Item;onSaved:(item:Item)=>void;onCancel:()=>void;onBusy?:(busy:boolean)=>void;embedded?:boolean}) {
  const client=useQueryClient(),{me}=useAuth()
  const [title,setTitle]=useState(item?.title ?? ''),[description,setDescription]=useState(item?.description ?? '')
  const [consumable,setConsumable]=useState(item?.is_consumable ?? false),[quantity,setQuantity]=useState(String(item?.quantity ?? 1))
  const [file,setFile]=useState<File|null>(null),[selected,setSelected]=useState<string[]>(cacheId?[cacheId]:[])
  const progress=useRef<ItemSaveProgress>({item:null,remainingCacheIds:[],photoPending:false,stage:'saving'})
  const [saved,setSaved]=useState<ItemSaveProgress|null>(null)
  const caches=useQuery({queryKey:['caches'],queryFn:()=>apiFetch<CacheSummary[]>('/api/caches'),enabled:!item && !!me?.display_name})
  const save=useMutation({
    mutationFn:async()=>{
      const photo=file && (!progress.current.item || progress.current.photoPending)?await resizePhoto(file):null
      return persistItem(progress.current,{cacheId,itemId:item?.id,cacheIds:selected,photo,
        body:{title,description:description.trim() || null,quantity:consumable?Number(quantity):null,...(!item?{is_consumable:consumable}:{})}},
        ()=>setSaved({...progress.current}))
    },
    onSuccess:persisted=>onSaved(persisted),
    onSettled:async()=>{onBusy?.(false);await invalidateRequestViews(client)},
  })
  function submit(event:FormEvent) {event.preventDefault();onBusy?.(true);save.mutate()}
  const locked=save.isPending || !!saved?.item
  const validQuantity=!consumable || (quantity!=='' && Number.isInteger(Number(quantity)) && Number(quantity)>=0 && Number(quantity)<=9999)
  const disabled=save.isPending || !title.trim() || !validQuantity
  const action=saved?.item ? saved.photoPending?'Retry photo':'Retry sharing' : embedded?item?'Save item':'Create and add here':'Save'
  return <form className={`cc-item-form${embedded?' cc-item-form-embedded':''}`} onSubmit={submit}>
    {!embedded && <div className="cc-item-editor-nav"><button type="button" disabled={save.isPending || !!saved?.item} onClick={onCancel}>Cancel</button><h1>{item?'Edit item':'New item'}</h1><button type="submit" disabled={disabled}>{save.isPending?'Saving…':action}</button></div>}
    <fieldset disabled={locked} className="cc-item-fields">
      {!item && <label className="cc-new-photo-zone" htmlFor="new-item-photo"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg><strong>{file?file.name:'Add a photo'}</strong><span>Optional. Without one, the tile shows the name.</span><input id="new-item-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>setFile(event.target.files?.[0] ?? null)} /></label>}
      {item ? <p className="cc-form-hint">{consumable?'Give it away':'Lend it'} · Item type cannot be changed.</p> : <fieldset className="cc-item-kind-tabs"><legend className="sr-only">How would you like to share it?</legend><label><input type="radio" name="item-type" checked={!consumable} onChange={()=>setConsumable(false)} /><span>Lend it</span></label><label><input type="radio" name="item-type" checked={consumable} onChange={()=>setConsumable(true)} /><span>Give it away</span></label></fieldset>}
      <div className="cc-item-title-field"><label htmlFor="item-title">What is it?</label><input autoFocus={!!item} id="item-title" type="text" required maxLength={240} value={title} onChange={event=>setTitle([...event.target.value].slice(0,120).join(''))} className="cc-profile-input" /></div>
      {consumable && <div className="cc-stock-stepper"><label htmlFor="item-quantity">How many to give?</label><button type="button" aria-label="Decrease stock quantity" disabled={Number(quantity)<=0} onClick={()=>setQuantity(String(Math.max(0,Number(quantity)-1)))}>−</button><input id="item-quantity" aria-describedby="quantity-help" type="number" inputMode="numeric" required min={0} max={9999} step={1} value={quantity} style={{width:`${Math.max(1,quantity.length)}ch`}} onChange={event=>setQuantity(event.target.value)} /><button type="button" aria-label="Increase stock quantity" disabled={Number(quantity)>=9999} onClick={()=>setQuantity(String(Math.min(9999,Number(quantity)+1)))}>+</button><span id="quantity-help" className="sr-only">Stock quantity 0–9999. One stock count across all caches; pending requests must stay covered.</span></div>}
      {!item && <fieldset className="cc-put-it-in"><legend>Put it in</legend>
        {caches.isPending && <div className="cc-skeleton-cache-options"><LoadingStatus label="Loading caches…" /><Shimmer width={130} height={38} /><Shimmer width={110} height={38} /></div>}
        {caches.isError && <div className="cc-read-error"><p role="alert">{errorMessage(caches.error)}</p><button type="button" onClick={()=>void caches.refetch()}>Try caches again</button></div>}
        <div>{caches.data && [...caches.data].sort((a,b)=>Number(selected.includes(b.id))-Number(selected.includes(a.id))).map(cache=><label key={cache.id} style={selected.includes(cache.id)?{background:boxColor(cache.id),color:'#201e1d'}:undefined}><input type="checkbox" checked={selected.includes(cache.id)} disabled={cache.id===cacheId || locked} onChange={event=>setSelected(current=>event.target.checked?[...current,cache.id]:current.filter(id=>id!==cache.id))} /><span aria-hidden="true" style={{background:boxColor(cache.id)}}>{selected.includes(cache.id)?'✓':''}</span>{cache.name}{cache.id===cacheId && <span className="sr-only">, shared here in the same create operation</span>}</label>)}</div>
        {caches.isSuccess && !caches.data.length && <p className="cc-form-hint">No caches yet. Your item stays private in your library.</p>}
        <p>One item, one stock count, wherever it's shown.</p>
      </fieldset>}
      <details className="cc-item-description-editor" open={!!item?.description}><summary>{description?'Edit note':'Add a note (optional)'}</summary><label htmlFor="item-description">Description (optional)</label><textarea id="item-description" rows={3} maxLength={4000} value={description} onChange={event=>setDescription([...event.target.value].slice(0,2000).join(''))} className="cc-profile-input" /></details>
    </fieldset>
    {saved?.item && save.isError && <div className="cc-item-save-progress" role="status"><p>Your item is saved{cacheId?' and shared here':' in your library'}. {saved.photoPending?'The photo needs retrying.':'Sharing needs retrying.'}</p>{!!saved.remainingCacheIds.length && <p>Still to share in: {saved.remainingCacheIds.map(id=>caches.data?.find(cache=>cache.id===id)?.name ?? 'selected cache').join(', ')}. Already shared caches are kept.</p>}</div>}
    {save.isError && <p role="alert" className="cc-form-error">{save.error instanceof Error && save.error.message===PHOTO_READ_ERROR?PHOTO_READ_ERROR:errorMessage(save.error)}</p>}
    {(embedded || saved?.item) && <div className="cc-item-save-actions"><button type="submit" disabled={disabled} className="cc-profile-primary">{save.isPending?'Saving…':action}</button>{saved?.photoPending ? <button type="button" disabled={save.isPending} className="cc-profile-secondary" onClick={()=>{progress.current.photoPending=false;onBusy?.(true);save.mutate()}}>Continue without photo</button> : saved?.item && saved.remainingCacheIds.length ? <button type="button" disabled={save.isPending} className="cc-profile-secondary" onClick={()=>onSaved(saved.item!)}>Keep item without remaining shares</button> : !saved?.item && <button type="button" disabled={save.isPending} onClick={onCancel} className="cc-profile-secondary">Cancel</button>}</div>}
  </form>
}
