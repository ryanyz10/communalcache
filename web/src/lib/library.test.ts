import { afterEach, expect, it, vi } from 'vitest'
import { createElement, createRef, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { LibraryPage } from '../pages/LibraryPage'
import { AddItemSheet } from '../pages/AddItemSheet'
import { ItemEditorPage } from '../pages/ItemEditorPage'
import { ItemPage } from '../pages/ItemPage'
import { ApiError } from './api'
import { attachSelected, libraryItemQuery, sharingHint, type LibraryItem } from './items'
import { uploadPhoto } from './photos'
import { invalidateRequestViews } from './requests'

const cacheId = '11111111-1111-4111-8111-111111111111'
const item: LibraryItem = {id:'22222222-2222-4222-8222-222222222222',cache_id:null,owner_id:'owner',owner_name:'Ryan',title:'Sugar',description:'Bring a jar',is_consumable:true,quantity:8,available_quantity:5,available:false,unavailable_note:'Back Sunday',created_at:1,photo_version:'version',caches:[{id:cacheId,name:'Maple Street'},{id:'garden',name:'Garden Club'}],pending_count:2}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function render(element: ReactElement, options: { route?: string; path?: string; caller?: string; state?: 'empty' | 'loading' | 'error'; more?: boolean } = {}) {
  const caller = options.caller ?? 'owner'
  const client = new QueryClient({defaultOptions:{queries:{retry:false,retryOnMount:false}}})
  client.setQueryData(['me'],{id:caller,display_name:'Ryan',email:'private@example.test'})
  client.setQueryData(['caches'],[{id:cacheId,name:'Maple Street'},{id:'garden',name:'Garden Club'},{id:'third',name:'Tool Shed'}])
  client.setQueryData(['library-item','owner',item.id],item)
  if (options.state === 'error') client.getQueryCache().build(client,{queryKey:['library',caller]}).setState({status:'error',error:new ApiError(503,'internal_error')})
  else if (options.state !== 'loading') client.setQueryData(['library',caller],{pages:[{items:options.state === 'empty' ? [] : caller === 'owner' ? [item,{...item,id:'unshared',title:'Tent',caches:[],pending_count:0,quantity:null,is_consumable:false,available:true,photo_version:null}] : [],next_cursor:options.more?'next':null}],pageParams:[null]})
  const routes = createElement(Routes,null,createElement(Route,{path:options.route??'/',element}))
  const markup = renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(MemoryRouter,{initialEntries:[options.path??'/']},routes)})))
  client.clear()
  return markup
}

it('renders caller library cards, names, shared stock, pending asks, private photo routes and wide grid without a cache dependency', () => {
  const markup = render(createElement(LibraryPage),{more:true})
  for (const copy of ['Your items','+ New item','Sugar','Maple Street · Garden Club','Give · 8 left','2 asks','Not in a cache yet','Load more items']) expect(markup).toContain(copy)
  expect(markup).toContain(`/items/${item.id}`)
  expect(markup).toContain(`/api/me/items/${item.id}/photo?v=version`)
  expect(markup).toContain('cc-library-slip')
  expect(markup).not.toContain('/api/caches/null')
  expect(markup).not.toContain('private@example.test')
})

it('separates empty, loading and error states, and does not display another account cached library', () => {
  expect(render(createElement(LibraryPage),{state:'empty'})).toContain('No items yet')
  const loading = render(createElement(LibraryPage),{state:'loading'})
  expect(loading).toContain('Loading your items')
  expect(loading).not.toContain('No items yet')
  const error = render(createElement(LibraryPage),{state:'error'})
  expect(error).toContain('role="alert"')
  expect(error).toContain('Try your items again')
  expect(error).not.toContain('No items yet')
  const other = render(createElement(LibraryPage),{caller:'other'})
  expect(other).not.toContain('Sugar')
  expect(other).not.toContain('Bring a jar')
})

it('keeps ceiling-limited continuation honest instead of claiming an empty filtered library', () => {
  const markup = render(createElement(LibraryPage), { state: 'empty', more: true })
  expect(markup).toContain('Showing matches from 0 loaded items. Load more to include the rest.')
  expect(markup).toContain('Load more items')
  expect(markup).not.toContain('No items yet')
  expect(markup).not.toContain('No items match this filter.')
})

it('does not reuse another account or cache-context detail through denial, refetch and account switch', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['item', cacheId, item.id], { ...item, title: 'Cache-only data' })
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(item))
  const observer = new QueryObserver(client, { ...libraryItemQuery('owner', item.id), enabled: false })
  expect((await observer.refetch()).data).toEqual(item)
  observer.setOptions({ ...libraryItemQuery('other', item.id), enabled: false })
  expect(observer.getCurrentResult().data).toBeUndefined()
  fetch.mockResolvedValue(Response.json({ error: 'not_found' }, { status: 404 }))
  const denied = await observer.refetch()
  expect(denied.data).toBeUndefined()
  expect(denied.error).toMatchObject({ status: 404 })
  expect(client.getQueryData(['library-item', 'owner', item.id])).toEqual(item)
  fetch.mockResolvedValue(Response.json({ ...item, owner_id: 'other', title: 'Other account item' }))
  expect((await observer.refetch()).data?.title).toBe('Other account item')
  expect(fetch.mock.calls.map(call => call[0])).toEqual(Array(3).fill(`/api/me/items/${item.id}`))
  expect(client.getQueryData(['item', cacheId, item.id])).toMatchObject({ title: 'Cache-only data' })
  observer.destroy(); client.clear()
})

it('offers existing/new sources in one labeled native sheet, with attached item rows pressed and disabled and other sharing hints', () => {
  const markup = render(createElement(AddItemSheet,{cacheId,cacheName:'Maple Street',dialog:createRef<HTMLDialogElement>()}))
  expect(markup.match(/<dialog\b/g)).toHaveLength(1)
  for (const copy of ['Add to Maple Street','Your items','New item','Already here','Not shared yet','Add 0 to Maple Street','Creates it in your library','Create and add here']) expect(markup).toContain(copy)
  expect(markup).toMatch(/<button(?=[^>]*class="cc-select-row")(?=[^>]*aria-pressed="true")(?=[^>]*disabled="")[^>]*>/)
  const choices = markup.match(/<ul class="cc-add-selection">([\s\S]*?)<\/ul>/)![1]
  expect(choices).toContain('aria-pressed="false"')
  expect(choices).not.toMatch(/<input|<svg/)
  expect(markup).toContain('aria-label="Choose item source"')
  expect(markup).toContain('aria-pressed="true"')
  expect(markup).toContain('for="new-item-photo"')
  expect(markup).toContain('for="item-title"')
  expect(markup).toContain('Lend it')
  expect(markup).toContain('Give it away')
  expect(sharingHint({...item,caches:[{id:'garden',name:'Garden Club'}]},cacheId)).toBe('In Garden Club')
})

it('keeps partial attachment successes and retries only failures, using idempotent owner routes with no item creation', async () => {
  const fetchMock = vi.spyOn(globalThis,'fetch').mockImplementation(async path => path.toString().includes('/two/') ? Response.json({error:'not_found'},{status:404}) : new Response(null,{status:204}))
  const selected = new Set(['one','two','three'])
  await expect(attachSelected([...selected],cacheId,id=>selected.delete(id))).rejects.toMatchObject({status:404})
  expect([...selected]).toEqual(['two','three'])
  fetchMock.mockResolvedValue(new Response(null,{status:204}))
  await attachSelected([...selected],cacheId,id=>selected.delete(id))
  expect([...selected]).toEqual([])
  expect(fetchMock.mock.calls.map(call=>call[0])).toEqual(['one','two','two','three'].map(id=>`/api/me/items/${id}/attachments/${cacheId}`))
  expect(fetchMock.mock.calls.every(call=>call[1]?.method==='PUT' && call[1]?.credentials==='same-origin')).toBe(true)
})

it('renders private owner item controls and active-cache pills with explicit detach consequences', () => {
  const markup = render(createElement(ItemPage),{route:'/items/:itemId',path:`/items/${item.id}`})
  for (const text of ['Shown in','Maple Street','Garden Club','Tool Shed','Save availability','Back Sunday','Pending asks in these caches get declined','Your library item, photos, stock and other caches are kept','Confirm stop sharing','Delete item','your library and every cache']) expect(markup).toContain(text)
  const sharing = markup.match(/<ul class="cc-select-options mt-3">([\s\S]*?)<\/ul>/)![1]
  expect(sharing.match(/aria-pressed="true"/g)).toHaveLength(2)
  expect(sharing).toContain('aria-pressed="false"')
  expect(sharing).not.toMatch(/<input|<svg/)
  expect(markup).toContain('role="switch"')
  expect(markup).toContain(`/items/${item.id}/edit`)
  expect(markup).toContain('View asks in Requests')
  expect(markup).not.toContain('Ask to borrow')
  const other = render(createElement(ItemPage),{caller:'other',route:'/items/:itemId',path:`/items/${item.id}`})
  expect(other).not.toContain('Sugar')
  expect(other).toContain('data-skeleton="item"')
  expect(other).toContain('role="status" class="sr-only">Loading item…')
  expect(other).not.toMatch(/Bring a jar|Back Sunday|shown-in-heading|type="checkbox"|\/api\/me\/items\//)
})

it('creates library-only items without needing caches and invalidates every shared item view after edits or decisions', async () => {
  const markup = render(createElement(ItemEditorPage),{route:'/items/new',path:'/items/new'})
  expect(markup).toContain('New item')
  expect(markup).toContain('>Save</button>')
  expect(markup).not.toContain('Loading…')
  const client = new QueryClient(), invalidate = vi.spyOn(client,'invalidateQueries').mockResolvedValue()
  await invalidateRequestViews(client)
  expect(invalidate.mock.calls.map(call=>call[0]?.queryKey?.[0])).toEqual(['item-requests','requests','item','items','library','library-item','home-summary','caches','cache','request-detail','request-contact'])
  const fetchMock = vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json(item))
  await uploadPhoto(null,item.id,new Blob(['JPEG'],{type:'image/jpeg'}))
  expect(fetchMock).toHaveBeenCalledWith(`/api/me/items/${item.id}/photo`,expect.objectContaining({method:'POST',credentials:'same-origin'}))
  client.clear()
})
