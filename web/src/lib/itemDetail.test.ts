import { afterEach, expect, it, vi } from 'vitest'
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

const id='11111111-1111-4111-8111-111111111111',cache='22222222-2222-4222-8222-222222222222'
const item:LibraryItem={id,cache_id:null,owner_id:'owner',owner_name:'Owner',title:'Stand mixer',description:'Comes with the dough hook',is_consumable:false,quantity:null,available:true,active:true,created_at:1,photo_version:null,caches:[{id:cache,name:'Maple St'},{id:'garden',name:'Garden Club'}],pending_count:2}
const first:ItemRequest={id:'one',item_id:id,item_title:item.title,cache_id:cache,cache_name:'Maple St',owner_id:'owner',owner_name:'Owner',requester_id:'sam',requester_name:'Sam',quantity:null,status:'pending',decision_reason:null,decided_at:null,created_at:1,queue_position:1}
const rows=[first,{...first,id:'two',cache_id:'garden',cache_name:'Garden Club',requester_id:'priya',requester_name:'Priya',created_at:2,queue_position:2}]
afterEach(()=>vi.restoreAllMocks())

function render(mode:'detail'|'edit'|'create'|'waiting', options:{rows?:ItemRequest[];caller?:string;more?:boolean;inactive?:boolean;error?:boolean}={}) {
  const caller=options.caller ?? 'owner',requests=options.rows ?? rows
  const client=new QueryClient({defaultOptions:{queries:{retry:false,retryOnMount:false,staleTime:Infinity}}})
  client.setQueryData(['me'],{id:caller,display_name:'Owner',email:'private@example.test'})
  const current={...item,active:!options.inactive,pending_count:requests.length}
  if(caller==='owner')client.setQueryData(['library-item','owner',id],current)
  client.setQueryData(['caches'],[{id:cache,name:'Maple St'},{id:'garden',name:'Garden Club'}])
  const key=['requests','incoming',id]
  if(options.error)client.getQueryCache().build(client,{queryKey:key}).setState({status:'error',error:new Error('offline')})
  else client.setQueryData(key,{pages:[{requests,unavailable_cache_ids:[],next_cursor:options.more?'next':null}],pageParams:[null]})
  const path=mode==='create'?'/items/new':`/items/${id}${mode==='edit'?'/edit':''}`
  const element=mode==='waiting'?createElement(ItemWaiting,{item:current,pendingCount:current.pending_count}):mode==='detail'?createElement(ItemPage):createElement(ItemEditorPage,{editing:mode==='edit'})
  const route=mode==='create'?'/items/new':mode==='edit'?'/items/:itemId/edit':'/items/:itemId'
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
