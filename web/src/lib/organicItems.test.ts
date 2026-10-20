import { afterEach,expect,it,vi } from 'vitest'
import { createElement,type ReactElement } from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter,Route,Routes } from 'react-router'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { LibraryPage } from '../pages/LibraryPage'
import { ItemEditorPage } from '../pages/ItemEditorPage'
import { ItemForm } from '../pages/ItemForm'
import { ItemPage } from '../pages/ItemPage'
import type { LibraryItem } from './items'
const cacheId='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222'
const item:LibraryItem={id,cache_id:cacheId,owner_id:'maya',owner_name:'Maya',owner_cat_coat:'ginger',title:'Crash pad',description:'Brush the chalk off after, please.',is_consumable:false,quantity:null,available:true,photo_version:null,created_at:1,caches:[{id:cacheId,name:'Climbing crew'}],pending_count:1}
function render(element:ReactElement,path:string,route:string,owner=false) {
  const client=new QueryClient({defaultOptions:{queries:{retry:false,retryOnMount:false}}})
  vi.stubGlobal('location',{origin:'http://localhost:8797'})
  client.setQueryData(['me'],{id:owner?'maya':'ryan',display_name:'Ryan',email:'private@example.com',cat_coat:'grey'})
  client.setQueryData(['cache',cacheId],{id:cacheId,name:'Climbing crew',owner_id:'maya'})
  client.setQueryData(['caches'],[{id:cacheId,name:'Climbing crew'}])
  client.setQueryData(['item',cacheId,id],item)
  client.setQueryData(['library-item','maya',id],{...item,cache_id:null})
  client.setQueryData(['home-summary'],{owned_item_count:87,pending_answer_count:29,incoming:[],outgoing:[]})
  client.setQueryData(['library','ryan'],{pages:[{items:[item],next_cursor:'next',totals:{total_count:87,lend_count:60,give_count:27,unshared_count:5,shared_cache_count:3}}],pageParams:[null]})
  client.setQueryData(['item-requests',cacheId,id],[{id:'ask',cache_id:cacheId,item_id:id,item_title:'Crash pad',owner_id:'maya',owner_name:'Maya',requester_id:'jun',requester_name:'Jun',quantity:null,status:'pending',created_at:Date.now()-86400000}])
  const children=createElement(MemoryRouter,{initialEntries:[path]},createElement(Routes,null,createElement(Route,{path:route,element})))
  const html=renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children})))
  client.clear();return html
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
it('uses exact whole-library totals, not the loaded page, and keeps filtered pagination reachable',()=>{
  const html=render(createElement(LibraryPage),'/items','/items')
  for(const text of ['87 things','in 3 caches','29 asks','To lend','To give','Not shared yet','Load more items','cc-library-slip','cc-library-row','cc-library-chips'])expect(html).toContain(text)
  expect(html).not.toContain('private@example.com')
  expect(html).not.toContain('1 thing ·')
})
it('shows the owner cat/name tile and packing slip with a native trigger to the still-working request form',()=>{
  const html=render(createElement(ItemPage),`/caches/${cacheId}/items/${id}`,'/caches/:cacheId/items/:itemId')
  for(const text of ['cc-item-owner-cat','cc-item-name-art','<dt>From</dt>','Maya','Lend · it comes back','Climbing crew','Brush the chalk','Ask to borrow','Ask Maya','aria-controls="item-ask-sheet"','Jun','Pending'])expect(html).toContain(text)
  expect(html).toContain('aria-haspopup="dialog"')
  expect(html).not.toContain('id="item-ask-form"')
  expect(html).not.toMatch(/Delete item|Edit item|Upload photo|private@example.com/)
})
it('keeps private owner editing, manual availability, sharing and distinct destructive confirmations',()=>{
  const html=render(createElement(ItemPage),`/items/${id}`,'/items/:itemId',true)
  for(const text of ['Edit item','Save availability','200 characters','Shown in','Climbing crew','Delete item','Confirm deletion','your library and every cache','Upload photo'])expect(html).toContain(text)
  expect(html).not.toContain('Ask to borrow')
})
it('keeps the new form empty, photo optional, type native, caches selectable and optional description reachable',()=>{
  const html=render(createElement(ItemEditorPage),'/items/new','/items/new')
  for(const text of ['New item','>Save</button>','for="new-item-photo"','accept="image/*"','Lend it','Give it away','for="item-title"','Put it in','aria-pressed="false"','Description (optional)'])expect(html).toContain(text)
  expect(html).not.toContain('One item, one stock count')
  expect(html).not.toContain('value="Mason jars"')
  expect(html).not.toContain('private@example.com')
  expect(html).toContain('<dialog class="cc-item-editor"')
  expect(html).toContain('class="organic-library"')
})
it('uses accessible cache pills with segment colors and no checkbox indicators', () => {
  const unchecked = render(createElement(ItemEditorPage), '/items/new', '/items/new')
  const selected = render(createElement(ItemForm, { cacheId, onSaved: vi.fn(), onCancel: vi.fn() }), '/', '/')
  expect(unchecked).toContain('<button type="button" class="cc-select-pill" aria-pressed="false">Climbing crew</button>')
  expect(selected).toContain('<button type="button" class="cc-select-pill" aria-pressed="true" disabled="">Climbing crew')
  expect(selected).toContain('shared here in the same create operation')
  for (const markup of [unchecked, selected]) {
    const choices = markup.match(/<fieldset class="cc-put-it-in">([\s\S]*?)<\/fieldset>/)![1]
    expect(choices).not.toMatch(/<input|<svg|aria-hidden="true"/)
  }
  const css = readFileSync(new URL('../items.css', import.meta.url), 'utf8')
  const chip = css.match(/\.cc-select-pill, \.cc-select-row \{([^}]+)\}/)![1]
  expect(chip).toContain('min-height: 40px')
  expect(chip).toContain('background: var(--cc-chip)')
  const selectedChip = css.match(/\.cc-select-pill\[aria-pressed="true"\], \.cc-select-row\[aria-pressed="true"\] \{([^}]+)\}/)![1]
  for (const rule of ['background: var(--cc-fg)', 'color: var(--cc-bg)']) expect(selectedChip).toContain(rule)
  expect(css).toContain('.cc-select-pill:focus-visible')
  expect(css).toContain('.cc-select-pill:disabled')
  expect(css).not.toContain('.cc-put-it-in label > span')
})
