import { afterEach,expect,it,vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter,Route,Routes } from 'react-router'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { HomePage } from '../pages/HomePage'
import { CachePage } from '../pages/CachePage'
import { AppHeader } from '../components/AppHeader'
import { askedWhen,filterContents,greeting,incomingDescription } from './caches'
import type { LibraryItem } from './items'
import { boxColor } from '../components/Box'

const id='11111111-1111-4111-8111-111111111111'
const item:LibraryItem={id:'tent',cache_id:id,owner_id:'me',owner_name:'Ryan',title:'4-person tent',description:'Camp in comfort',is_consumable:false,quantity:null,available:true,created_at:1,photo_version:null,caches:[{id,name:'Maple St. Neighbors'}],pending_count:1}
const members=[{user_id:'me',display_name:'Ryan',cat_coat:'grey',attached_item_count:1},{user_id:'dev',display_name:'Dev',cat_coat:'oat',attached_item_count:0}]
const cache={id,name:'Maple St. Neighbors',owner_id:'me',requires_approval:true,active_member_count:6,attached_item_count:24,pending_answer_count:29,member_preview:members,members,invite_token:id+'.'+'A'.repeat(43)}
const preview={id:'ask',cache_id:id,item_id:item.id,item_title:item.title,user_id:'dev',display_name:'Dev',cat_coat:'oat' as const,profile_photo_version:null,created_at:1,quantity:null}
function render(home:boolean,empty=false) {
  vi.stubGlobal('location',{origin:'http://localhost:8797'})
  vi.stubGlobal('sessionStorage',{getItem:()=>null})
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  client.setQueryData(['me'],{id:'me',display_name:'Ryan',email:'private@example.com'})
  client.setQueryData(['caches'],[cache])
  client.setQueryData(['cache',id],cache)
  client.setQueryData(['items',id],[item])
  client.setQueryData(['join-requests',id],[])
  client.setQueryData(['library','me'],{pages:[{items:empty?[]:[item],next_cursor:empty?null:'next'}],pageParams:[null]})
  client.setQueryData(['home-summary'],empty?{owned_item_count:0,pending_answer_count:0,incoming:[],outgoing:[]}:{owned_item_count:87,pending_answer_count:29,incoming:[preview],outgoing:[{...preview,status:'approved'}]})
  client.setQueryData(['requests'],{pages:[{requests:[],next_cursor:null}],pageParams:[null]})
  const children=createElement(MemoryRouter,{initialEntries:[home?'/':`/caches/${id}`]},createElement(AppHeader),createElement(Routes,null,createElement(Route,{path:home?'/':'/caches/:cacheId',element:createElement(home?HomePage:CachePage)})))
  const html=renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children})))
  client.clear();return html
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})

it('filters the complete authorized contents by kind and text, preserving subtype/empty results',()=>{
  const give={...item,id:'jars',title:'Mason jars',is_consumable:true,description:null,quantity:8}
  const rows=[item,give]
  expect(filterContents(rows,'all','')).toHaveLength(2)
  expect(filterContents(rows,'lend',' CAMP ')).toEqual([item])
  expect(filterContents(rows,'give','JARS')).toEqual([give])
  expect(filterContents(rows,'give','tent')).toEqual([])
  expect(filterContents(rows,'all','ryan')).toHaveLength(2)
})
it('formats elapsed ask times without inferring any handoff or due date',()=>{
  const day=86_400_000
  expect(askedWhen(day,day)).toBe('Asked today')
  expect(askedWhen(0,day)).toBe('Asked yesterday')
  expect(askedWhen(0,3*day)).toBe('Asked 3 days ago')
})
it('uses time, true totals and ID-derived color rather than first-page counts or editable names',()=>{
  expect([greeting(6),greeting(14),greeting(21)]).toEqual(['Good morning','Good afternoon','Good evening'])
  expect(incomingDescription(preview)).toBe('Dev wants to borrow your 4-person tent.')
  expect(incomingDescription({...preview,quantity:2,item_title:'mason jars'})).toBe('Dev asked for 2 mason jars.')
  expect(boxColor(id)).toBe(boxColor(id))
  expect(['#f6a06b','#aebf92','#dcd3c4']).toContain(boxColor(id))
  const html=render(true)
  for(const text of ['See all 87','29 asks need your answer','6 neighbors · 24 things','Dev wants to borrow your 4-person tent.','See how to reach Dev','APPROVED']) expect(html.toLowerCase()).toContain(text.toLowerCase())
  expect(html).toContain('cc-thing-tile-deep')
  expect(html).not.toMatch(/first page|private@example|mailto:|sms:|data-opening/)
})
it('shows empty rows inside the existing slips when you have no things or asks',()=>{
  const html=render(true,true)
  expect(html).toContain('No things yet.')
  expect(html).toContain('No asks in your current caches.')
  expect(html).toContain('<ul class="cc-packing-slip cc-home-things"><li class="cc-list-empty"><p>No things yet.</p>')
  expect(html).toContain('<ul class="cc-packing-slip cc-home-asks"><li class="cc-list-empty"><p>No asks in your current caches.</p>')
  expect(html).toContain('>See all</a>')
})
it('retains native dialogs, labelled create fields, real bot-dependent submit and private preview defaults',()=>{
  const html=render(true)
  expect(html).toContain('aria-haspopup="dialog"')
  expect(html).toContain('New cache or join with an invite')
  expect(html).toContain('aria-labelledby="new-cache-heading"')
  expect(html).toContain('for="cache-name"')
  expect(html).toContain('aria-describedby="cache-name-count"')
  expect(html).toContain('0 / 60')
  expect(html).toContain('Off: anyone with the invite joins right away.')
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Create cache/)
  expect(html).not.toContain('Bot check passed')
})
it('renders folder navigation, one contents list, scoped member counts and accessible filters/search',()=>{
  const html=render(false)
  for(const text of ['aria-label="Your caches"','aria-label="Filter contents"','aria-pressed="true"','Search contents','In the box','1 thing','0 things','Cache settings']) expect(html).toContain(text)
  expect(html.match(/class="cc-contents-row"/g)).toHaveLength(1)
  expect(html).not.toContain('>Cache settings</a>')
  expect(html).toContain('cc-thing-tile-pale')
  expect(html).toContain('/caches/'+id+'/items/tent')
  expect(html).not.toContain('private@example.com')
})
