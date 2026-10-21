import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { ItemPage } from '../pages/ItemPage'
import { ItemEditorPage } from '../pages/ItemEditorPage'
import { ItemWaiting } from '../pages/ItemWaiting'
import { AppHeader } from '../components/AppHeader'
import { useRequests, type ItemRequest } from './requests'
import type { LibraryItem } from './items'
import { ApiError } from './api'

const id='11111111-1111-4111-8111-111111111111',cache='22222222-2222-4222-8222-222222222222'
const item:LibraryItem={id,cache_id:null,owner_id:'owner',owner_name:'Owner',title:'Stand mixer',description:'Comes with the dough hook',is_consumable:false,quantity:null,available:true,active:true,created_at:1,photo_version:null,caches:[{id:cache,name:'Maple St'},{id:'garden',name:'Garden Club'}],pending_count:2}
const first:ItemRequest={id:'one',item_id:id,item_title:item.title,cache_id:cache,cache_name:'Maple St',owner_id:'owner',owner_name:'Owner',requester_id:'sam',requester_name:'Sam',quantity:null,status:'pending',decision_reason:null,decided_at:null,created_at:1,queue_position:1}
const rows=[first,{...first,id:'two',cache_id:'garden',cache_name:'Garden Club',requester_id:'priya',requester_name:'Priya',created_at:2,queue_position:2}]
afterEach(()=>vi.restoreAllMocks())

function render(mode:'detail'|'edit'|'create'|'waiting', options:{rows?:ItemRequest[];caller?:string;more?:boolean;inactive?:boolean;error?:boolean;inCache?:boolean;lent?:boolean;stock?:number;photo?:boolean;cacheDenied?:boolean;libraryMissing?:boolean}={}) {
  const caller=options.caller ?? 'owner',requests=options.rows ?? rows
  const client=new QueryClient({defaultOptions:{queries:{retry:false,retryOnMount:false,staleTime:Infinity}}})
  client.setQueryData(['me'],{id:caller,display_name:'Owner',email:'private@example.test'})
  const current={...item,active:!options.inactive,available:!options.lent,pending_count:requests.length,is_consumable:options.stock!==undefined,quantity:options.stock??null,available_quantity:options.stock,photo_version:options.photo?'photo':null}
  if(caller==='owner' && !options.libraryMissing)client.setQueryData(['library-item','owner',id],current)
  client.setQueryData(['cache',cache],{id:cache,name:'Maple St'})
  if(options.cacheDenied)client.getQueryCache().build(client,{queryKey:['item',cache,id]}).setState({status:'error',error:new ApiError(404,'not_found')})
  else client.setQueryData(['item',cache,id],{...current,cache_id:cache,caches:undefined,pending_count:undefined})
  client.setQueryData(['item-requests',cache,id],[first])
  client.setQueryData(['caches'],[{id:cache,name:'Maple St'},{id:'garden',name:'Garden Club'}])
  const key=['requests','incoming',id]
  if(options.error)client.getQueryCache().build(client,{queryKey:key}).setState({status:'error',error:new Error('offline')})
  else client.setQueryData(key,{pages:[{requests,unavailable_cache_ids:[],next_cursor:options.more?'next':null}],pageParams:[null]})
  const prefix=options.inCache?`/caches/${cache}`:''
  const path=mode==='create'?'/items/new':`${prefix}/items/${id}${mode==='edit'?'/edit':''}`
  const element=mode==='waiting'?createElement(ItemWaiting,{item:current,pendingCount:current.pending_count}):mode==='detail'?createElement(ItemPage):createElement(ItemEditorPage,{editing:mode==='edit'})
  const route=mode==='create'?'/items/new':`${options.inCache?'/caches/:cacheId':''}/items/:itemId${mode==='edit'?'/edit':''}`
  const markup=renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(MemoryRouter,{initialEntries:[path]},createElement(AppHeader),createElement(Routes,null,createElement(Route,{path:route,element})))})))
  client.clear()
  return markup
}

it('private owner detail has hero actions, simple information and all-cache waiting positions wired to existing decisions',()=>{
  const html=render('detail')
  for(const copy of ['cc-owner-item-layout','cc-owner-hero-links','‹ Back','>Edit</a>','Stand mixer','>Lend</p>','Comes with the dough hook','cc-item-availability-row','Mark as lent out','In caches','Waiting · 2','Sam','Priya','Maple St','Garden Club','Next up','2nd','Approve request from Sam','Decline request from Priya','Mark as lent out'])expect(html).toContain(copy)
  expect(html.match(/aria-label="Approve request from/g)).toHaveLength(2)
  expect(html).toContain('approval-message-one')
  expect(html).toContain('aria-label="Mobile navigation"')
  for(const retired of ['cc-item-info-slip','cc-owner-availability','cc-owner-sharing','AVAILABLE','Delete item','View asks in Requests',"to change where it"])expect(html).not.toContain(retired)
})

it.each([false,true])('uses the same owner sections and route-specific Back for cache context %s',inCache=>{
  const html=render('detail',{inCache,photo:true})
  expect(html).toContain('class="cc-owner-item-detail"')
  expect(html).toContain(`<a href="${inCache?`/caches/${cache}`:'/items'}" data-discover="true">‹ Back</a>`)
  for(const copy of ['cc-owner-hero','cc-owner-info','cc-owner-kind','Note','Availability','In caches','Garden Club','Waiting · 2','Approve request from Sam','Decline request from Priya'])expect(html).toContain(copy)
  expect(html).toContain(`/api/me/items/${id}/photo?v=photo`)
  expect(html.match(/role="status">Available/g)).toHaveLength(1)
  expect(html.includes('aria-label="Mobile navigation"')).toBe(!inCache)
  expect(html).not.toMatch(/organic-item-detail|cc-item-owner-cat|cc-item-info-slip|cc-item-from|cc-detail-ask|>From</)
})

it('uses that layout for a member without mounting private sharing, library photos or waiting decisions',()=>{
  const html=render('detail',{caller:'sam',inCache:true,photo:true})
  for(const copy of ['cc-owner-item-detail','cc-owner-hero','cc-owner-info','cc-owner-kind','Note','cc-item-from','cc-avatar','Owner','Ask to borrow','Ask Owner to borrow it','cc-member-asks','Sam','Pending','aria-controls="item-ask-sheet"'])expect(html).toContain(copy)
  expect(html).toContain(`href="/caches/${cache}"`)
  expect(html).toContain(`/api/caches/${cache}/items/${id}/photo?v=photo`)
  expect(html).not.toMatch(/organic-item-detail|cc-item-owner-cat|>Edit<\/a>|In caches|Garden Club|Priya|cc-owner-waiting|Approve request|Decline request|Mark as lent out|\/api\/me\/items|Mobile navigation/)
  expect(html).toContain('aria-expanded="false" aria-haspopup="dialog"')
  expect(html).not.toContain('id="item-ask-sheet"')
})

it.each([
  [{},'Lend',null,false,'Ask to borrow'],
  [{lent:true},'Lend','Lent out',true,'Ask to borrow'],
  [{stock:3},'Give · 3',null,false,'Ask for some'],
  [{stock:0},'Give · 0','None left',true,'Ask for some'],
  [{stock:3,lent:true},'Give · 3','Lent out',true,'Ask for some'],
])('stamps a member view only when unavailable and keeps ask rules for %j',(options,kind,stamp,disabled,copy)=>{
  const html=render('detail',{...options,caller:'sam',inCache:true})
  expect(html).toContain(`<p class="cc-owner-kind">${kind}</p>`)
  if(stamp)expect(html).toContain(`>${stamp}</span>`)
  else expect(html).not.toMatch(/>(Available|Lent out|None left)<\/span>/)
  expect(html).toContain(copy)
  const trigger=html.match(/<button[^>]*aria-controls="item-ask-sheet"[^>]*>/)![0]
  expect(trigger.includes('disabled=""')).toBe(disabled)
})

it('does not bypass a cache denial with cached owner-library data and waits for owner detail after admission',()=>{
  const denied=render('detail',{inCache:true,cacheDenied:true})
  expect(denied).toContain('not available, or you are no longer a member')
  expect(denied).toContain(`href="/caches/${cache}"`)
  expect(denied).not.toMatch(/Stand mixer|Garden Club|Approve request/)
  const loading=render('detail',{inCache:true,libraryMissing:true})
  expect(loading).toContain('data-skeleton="item"')
  expect(loading).not.toMatch(/Stand mixer|In caches|Approve request/)
})

it('enables the owner-library read only after the cache read confirms ownership',()=>{
  for(const caller of ['owner','member'])for(const cacheState of ['pending','success','error']){
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
    client.setQueryData(['me'],{id:caller,display_name:'Neighbor'})
    const key=['item',cache,id]
    if(cacheState==='success')client.setQueryData(key,{...item,cache_id:cache})
    if(cacheState==='error')client.getQueryCache().build(client,{queryKey:key}).setState({status:'error',error:new Error('Not found')})
    renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(MemoryRouter,{initialEntries:[`/caches/${cache}/items/${id}`]},createElement(Routes,null,createElement(Route,{path:'/caches/:cacheId/items/:itemId',element:createElement(ItemPage)})))})))
    const library=client.getQueryCache().find({queryKey:['library-item',caller,id],exact:true})!
    expect(library.options).toMatchObject({enabled:caller==='owner' && cacheState==='success'})
    expect(client.getQueryCache().find({queryKey:key,exact:true})!.options).toMatchObject({enabled:true})
    client.clear()
  }
})

it('keeps requester name before a separately ellipsized cache with its full title',()=>{
  const cacheName='A very long neighborhood cache name that must remain accessible'
  const html=render('waiting',{rows:[{...first,cache_name:cacheName}]})
  expect(html).toContain(`<p class="cc-item-wait-identity"><strong>Sam</strong><span class="cc-item-wait-cache" title="${cacheName}">· ${cacheName}</span></p>`)
  const css=readFileSync(new URL('../items.css',import.meta.url),'utf8')
  expect(css).toMatch(/\.cc-item-wait-identity\s*\{[^}]*display: flex;[^}]*min-width: 0;[^}]*white-space: nowrap/)
  expect(css).toMatch(/\.cc-item-wait-identity > strong\s*\{[^}]*flex: none;[^}]*max-width: 100%;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis/)
  expect(css).toMatch(/\.cc-item-wait-cache\s*\{[^}]*min-width: 0;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap/)
})

it('hides an empty waiting section and retains inactive detail tag with usable Edit/availability controls',()=>{
  const empty=render('detail',{rows:[]})
  expect(empty).not.toContain('cc-owner-waiting')
  expect(empty).not.toContain('Waiting ·')
  const inactive=render('detail',{rows:[],inactive:true})
  for(const copy of ['cc-item-detail-inactive','Inactive','>Edit</a>','Mark as lent out'])expect(inactive).toContain(copy)
})

it('owner waiting failures are retryable and pagination is explicit rather than silently client-filtered',()=>{
  const more=render('waiting',{more:true})
  expect(more).toContain('Load more waiting requests')
  const error=render('waiting',{error:true})
  expect(error).toContain('role="alert"')
  expect(error).toContain('Try waiting requests again')
  const denied=render('waiting',{caller:'other'})
  expect(denied).not.toMatch(/Sam|Priya|Approve request|cc-owner-waiting/)
  expect(render('detail',{caller:'other'})).not.toContain('Stand mixer')
})

it('delete is separated below edit fields with the existing confirmation and absent from create/detail',()=>{
  const editing=render('edit')
  expect(editing).toContain('cc-item-editor-delete')
  expect(editing).toContain('Delete Stand mixer everywhere?')
  expect(editing).toContain('Confirm deletion')
  expect(editing.indexOf('cc-item-editor-delete')).toBeGreaterThan(editing.lastIndexOf('id="item-description"'))
  expect(render('create')).not.toContain('Delete item')
  expect(render('detail')).not.toContain('Delete item')
})

it('item-filtered incoming requests use an isolated key and exact bound-filter URL with cookie auth',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  function Probe(){useRequests(true,'incoming',id);return null}
  renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(Probe)))
  const key=['requests','incoming',id],query=client.getQueryCache().find({queryKey:key,exact:true})!
  expect(query.queryKey).toEqual(key)
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({requests:rows,unavailable_cache_ids:[],next_cursor:null}))
  const observer=new QueryObserver(client,{...query.options,queryKey:key,enabled:false})
  await observer.refetch()
  expect(fetch).toHaveBeenCalledWith(`/api/requests?view=incoming&item_id=${id}`,expect.objectContaining({credentials:'same-origin',method:'GET'}))
  observer.destroy();client.clear()
})
