import { useEffect,useRef,useState,type FormEvent } from 'react'
import { Link,Navigate,useLocation,useNavigate,useParams } from 'react-router'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch,errorMessage } from '../lib/api'
import { cacheDetailQuery } from '../lib/caches'
import { libraryItemQuery,type Item,type LibraryItem } from '../lib/items'
import { invalidateRequestViews } from '../lib/requests'
import { OnboardingPage } from './OnboardingPage'
import { ItemPhoto,PhotoUpload } from './ItemPhoto'
import { ItemRequests } from './RequestsPage'
import { Avatar } from '../components/Avatar'
import { Cat } from '../components/Cat'
import { Stamp } from '../components/Stamp'
import { boxColor } from '../components/Box'
import { ItemForm } from './ItemForm'
import { ShownIn } from './ShownIn'
import { ItemSkeleton, ItemEditorSkeleton } from '../components/skeletons/ItemSkeletons'

function DeleteItem({item}:{item:Item}) {
  const dialog=useRef<HTMLDialogElement>(null),client=useQueryClient(),navigate=useNavigate()
  const remove=useMutation({
    mutationFn:()=>apiFetch<void>(`/api/me/items/${item.id}`,{method:'DELETE'}),
    onSuccess:async()=>{
      dialog.current?.close();navigate('/items')
      client.removeQueries({queryKey:['item']});client.removeQueries({queryKey:['library-item']});client.removeQueries({queryKey:['item-requests']})
      await invalidateRequestViews(client)
    },
  })
  return <><button type="button" className="cc-profile-secondary cc-delete-item" onClick={()=>{remove.reset();dialog.current?.showModal()}}>Delete item</button>
    <dialog ref={dialog} className="cc-item-confirm" aria-labelledby="delete-item-heading" onCancel={event=>{if(remove.isPending)event.preventDefault()}}><h2 id="delete-item-heading">Delete {item.title} everywhere?</h2>
      <ul><li>This permanently removes the item from your library and every cache.</li><li>Its request history is erased. Neighbors with pending requests will be notified.</li><li>Its private photos are queued for cleanup.</li></ul>
      {remove.isError && <p role="alert" className="cc-form-error">{errorMessage(remove.error)}</p>}
      <div className="cc-inline-actions"><button type="button" autoFocus disabled={remove.isPending} className="cc-profile-secondary" onClick={()=>dialog.current?.close()}>Cancel</button><button type="button" disabled={remove.isPending} className="cc-profile-primary" onClick={()=>remove.mutate()}>{remove.isPending?'Deleting…':'Confirm deletion'}</button></div>
    </dialog></>
}
function ItemAvailability({item}:{item:Item}) {
  const client=useQueryClient(),[lentOut,setLentOut]=useState(item.available===false),[note,setNote]=useState(item.unavailable_note ?? '')
  const noteTooLong=[...note.trim()].length>200
  const save=useMutation({mutationFn:()=>apiFetch(`/api/me/items/${item.id}`,{method:'PATCH',body:{available:!lentOut,unavailable_note:note.trim() || null}}),onSettled:()=>invalidateRequestViews(client)})
  function submit(event:FormEvent) {event.preventDefault();if(!noteTooLong)save.mutate()}
  return <form className="cc-owner-availability" onSubmit={submit} aria-label="Item availability"><h2>Availability</h2>
    <label className="cc-owner-availability-toggle"><span>Lent out</span><input type="checkbox" role="switch" aria-checked={lentOut} checked={lentOut} disabled={save.isPending} onChange={event=>setLentOut(event.target.checked)} className="cc-switch" /></label>
    <label htmlFor="unavailable-note">Lent out note (optional)</label><input id="unavailable-note" value={note} disabled={save.isPending} onChange={event=>setNote(event.target.value)} className="cc-profile-input" /><p className="cc-form-hint">Up to 200 characters. This blocks new requests, not existing pending requests.</p>
    {noteTooLong && <p role="alert" className="cc-form-error">Keep the note within 200 characters.</p>}{save.isError && <p role="alert" className="cc-form-error">{errorMessage(save.error)}</p>}{save.isSuccess && <p role="status">Availability saved.</p>}
    <button type="submit" disabled={save.isPending || noteTooLong} className="cc-profile-secondary">{save.isPending?'Saving…':'Save availability'}</button>
  </form>
}

export function ItemPage() {
  const {cacheId,itemId=''}=useParams(),{me}=useAuth(),location=useLocation()
  const [askOpen,setAskOpen]=useState(false)
  const query=useQuery<Item & Partial<Pick<LibraryItem,'caches'>>>({...(cacheId?{queryKey:['item',cacheId,itemId],queryFn:()=>apiFetch<Item>(`/api/caches/${cacheId}/items/${itemId}`)}:libraryItemQuery(me?.id,itemId)),enabled:!!me?.display_name})
  const cache=useQuery({...cacheDetailQuery(cacheId),enabled:!!cacheId && !!me?.display_name})
  useEffect(()=>{if(query.isSuccess && location.hash==='#sharing')document.getElementById('sharing')?.scrollIntoView()},[query.isSuccess,location.hash])
  const back=cacheId?`/caches/${cacheId}`:'/items',cacheName=cache.data?.name ?? 'Cache'
  if(!me) return <Navigate to="/login" replace />
  if(!me.display_name) return <OnboardingPage />
  if(query.isPending) return <ItemSkeleton cacheId={cacheId} />
  if(query.isError) return <main className="cc-page"><Link to={back}>‹ {cacheId?'Back to cache':'Your items'}</Link><p role="alert" className="cc-form-error">{errorMessage(query.error)}</p><button className="cc-text-action" onClick={()=>void query.refetch()}>Try again</button></main>
  const item=query.data,owner=item.owner_id===me.id
  const available=item.available!==false && (!item.is_consumable || (item.available_quantity ?? 0)>0)
  return <main className={`organic-item-detail${!owner && cacheId?' cc-member-item-detail':''}`}>
    <nav className="cc-item-breadcrumb" aria-label="Breadcrumb"><Link to={back}>{cacheId && <span aria-hidden="true" style={{background:boxColor(cacheId)}} /> }<svg className="cc-phone-copy" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>{cacheId?cacheName:'Your items'}</Link><span className="cc-desktop-copy">›</span><span className="cc-desktop-copy">{item.title}</span></nav>
    <div className="cc-organic-item-layout"><div className="cc-item-art"><span className="cc-item-owner-cat" aria-hidden="true"><Cat userId={item.owner_id} coat={item.owner_cat_coat} pose="loaf" /></span><ItemPhoto key={item.photo_version} item={item} /></div>
      <div className="cc-organic-item-copy"><div className="cc-item-detail-title"><h1>{item.title}</h1><Stamp tone={available?'ok':'muted'}>{available?'Available':item.available===false?'Lent out':'No stock'}</Stamp></div>
        <dl className="cc-item-info-slip"><div><dt>From</dt><dd><Avatar userId={item.owner_id} name={item.owner_name ?? 'Member'} photoVersion={item.owner_photo_version} coat={item.owner_cat_coat} size={28} />{owner?'You':item.owner_name ?? 'Member'}</dd></div><div><dt>Kind</dt><dd>{item.is_consumable?`Give · ${item.available_quantity ?? item.quantity} to give right now`:'Lend · it comes back'}</dd></div>
          <div className="cc-item-context"><dt>In</dt><dd>{cacheId?cacheName:item.caches?.length?item.caches.map(row=>row.name).join(' · '):'Your private library'}</dd></div>
          {item.description && <div className="cc-item-note"><dt>Note</dt><dd>{item.description}</dd></div>}
        </dl>
        {!owner && cacheId && <div className="cc-detail-ask"><p>If {item.owner_name ?? 'the owner'} says yes, you'll both see how to reach each other.</p><button type="button" disabled={!available} aria-expanded={askOpen} aria-haspopup="dialog" aria-controls="item-ask-sheet" onClick={()=>setAskOpen(true)}><span className="cc-desktop-copy">{item.is_consumable?'Ask for some':'Ask to borrow'}</span><span className="cc-phone-copy">Ask {item.owner_name ?? 'the owner'} {item.is_consumable?'for some':'to borrow it'}</span></button></div>}
        {cacheId && <ItemRequests item={item} compact askOpen={askOpen} onAskClose={()=>setAskOpen(false)} cacheName={cache.data?.name} />}
        {owner && <div className="cc-owner-item-controls"><div className="cc-inline-actions"><Link to={cacheId?`/caches/${cacheId}/items/${itemId}/edit`:`/items/${itemId}/edit`} className="cc-profile-primary">Edit item</Link><DeleteItem item={item} /></div>
          <ItemAvailability key={`${item.id}:${item.available}:${item.unavailable_note ?? ''}`} item={item} /><div id="sharing"><ShownIn item={item} /></div><PhotoUpload item={item} />{!cacheId && <Link to="/requests" className="cc-profile-secondary">View asks in Requests</Link>}
        </div>}
      </div>
    </div>
  </main>
}

export function ItemEditorPage({editing=false}:{editing?:boolean}) {
  const {cacheId,itemId=''}=useParams(),{me}=useAuth(),navigate=useNavigate()
  const cache=useQuery({...cacheDetailQuery(cacheId),enabled:!!cacheId && !!me?.display_name})
  const item=useQuery<Item>({...(cacheId?{queryKey:['item',cacheId,itemId],queryFn:()=>apiFetch<Item>(`/api/caches/${cacheId}/items/${itemId}`)}:libraryItemQuery(me?.id,itemId)),enabled:editing && !!me?.display_name})
  const back=cacheId?`/caches/${cacheId}`:'/items'
  if(!me) return <Navigate to="/login" replace />
  if(!me.display_name) return <OnboardingPage />
  if(editing && item.isSuccess && item.data.owner_id!==me.id) return <Navigate to={back} replace />
  const error=(cacheId?cache.error:null) ?? (editing?item.error:null),pending=(!!cacheId && cache.isPending) || (editing && item.isPending)
  if(pending && !error) return <ItemEditorSkeleton editing={editing} />
  return <main className="organic-item-editor">
    {error && <div><p role="alert" className="cc-form-error">{errorMessage(error)}</p><button className="cc-text-action" onClick={()=>{if(cacheId)void cache.refetch();if(editing)void item.refetch()}}>Try again</button><Link to={back}>Cancel</Link></div>}
    {!pending && !error && <ItemForm key={editing?itemId:`new:${cacheId ?? 'library'}`} cacheId={cacheId ?? null} item={editing?item.data:undefined} onSaved={saved=>navigate(cacheId?`/caches/${cacheId}/items/${saved.id}`:`/items/${saved.id}`)} onCancel={()=>navigate(editing?cacheId?`/caches/${cacheId}/items/${itemId}`:`/items/${itemId}`:back)} />}
  </main>
}
