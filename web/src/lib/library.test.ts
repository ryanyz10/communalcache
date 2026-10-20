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
const item: LibraryItem = {id:'22222222-2222-4222-8222-222222222222',cache_id:null,owner_id:'owner',owner_name:'Ryan',title:'Sugar',description:'Bring a jar',is_consumable:true,quantity:8,available_quantity:5,available:false,created_at:1,photo_version:'version',caches:[{id:cacheId,name:'Maple Street'},{id:'garden',name:'Garden Club'}],pending_count:2}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function render(element: ReactElement, options: { route?: string; path?: string; caller?: string; state?: 'empty' | 'loading' | 'error'; more?: boolean; inactive?: boolean; unshared?: boolean } = {}) {
  const caller = options.caller ?? 'owner'
  const client = new QueryClient({defaultOptions:{queries:{retry:false,retryOnMount:false}}})
  client.setQueryData(['me'],{id:caller,display_name:'Ryan',email:'private@example.test'})
  client.setQueryData(['caches'],[{id:cacheId,name:'Maple Street'},{id:'garden',name:'Garden Club'},{id:'third',name:'Tool Shed'}])
  const currentItem = options.inactive ? {...item,active:false,pending_count:0,caches:options.unshared?[]:item.caches} : item
  client.setQueryData(['library-item','owner',item.id],currentItem)
  if (options.state === 'error') client.getQueryCache().build(client,{queryKey:['library',caller]}).setState({status:'error',error:new ApiError(503,'internal_error')})
  else if (options.state !== 'loading') client.setQueryData(['library',caller],{pages:[{items:options.state === 'empty' ? [] : caller === 'owner' ? [currentItem,{...item,id:'unshared',title:'Tent',caches:[],pending_count:0,quantity:null,is_consumable:false,available:true,photo_version:null}] : [],next_cursor:options.more?'next':null}],pageParams:[null]})
  const routes = createElement(Routes,null,createElement(Route,{path:options.route??'/',element}))
  const markup = renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(MemoryRouter,{initialEntries:[options.path??'/']},routes)})))
  client.clear()
  return markup
}

it('renders owner photo tiles with canonical stock and private detail links, without cache metadata or row actions', () => {
  const markup = render(createElement(LibraryPage),{more:true})
  for (const copy of ['Your items','+ New item','Sugar','Give · 8','Lent out','Load more items']) expect(markup).toContain(copy)
  expect(markup).toContain(`/items/${item.id}`)
  expect(markup).toContain(`/api/me/items/${item.id}/photo?v=version`)
  expect(markup).toContain('cc-library-grid')
  expect(markup).toContain('href="/items/unshared"')
  expect(markup).not.toMatch(/Maple Street|Garden Club|cc-library-hero|cc-library-row|cc-library-status|2 asks/)
  expect(markup).not.toContain('#sharing')
  expect(markup).not.toContain('/api/caches/null')
  expect(markup).not.toContain('private@example.test')
})

it('keeps inactive items greyed and tagged in the owner library while the private item controls stay usable', () => {
  const markup=render(createElement(LibraryPage),{inactive:true})
  expect(markup).toContain('cc-library-tile cc-item-inactive')
  expect(markup).not.toContain('cc-inactive-tag')
  expect(markup).toContain(' · Inactive</span>')
  const unshared=render(createElement(LibraryPage),{inactive:true,unshared:true})
  expect(unshared).toContain('Inactive</span>')
  expect(unshared).not.toContain('cc-inactive-tag')
  expect(markup).toContain(`/items/${item.id}`)
  const detail=render(createElement(ItemPage),{inactive:true,route:'/items/:itemId',path:`/items/${item.id}`})
  for (const copy of ['cc-item-detail-inactive','Inactive','>Edit</a>','Mark as available']) expect(detail).toContain(copy)
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
  for (const copy of ['Add to Maple Street','Your items','New item','Already here','Not shared yet','Add 0 to Maple Street']) expect(markup).toContain(copy)
  expect(markup).toMatch(/<button(?=[^>]*class="cc-select-row")(?=[^>]*aria-pressed="true")(?=[^>]*disabled="")[^>]*>/)
  const choices = markup.match(/<ul class="cc-add-selection">([\s\S]*?)<\/ul>/)![1]
  expect(choices).toContain('aria-pressed="false"')
  expect(choices).not.toMatch(/<input|<svg/)
  expect(markup).toContain('aria-label="Choose item source"')
  expect(markup).toContain('aria-pressed="true"')
  expect(markup).not.toContain('id="item-title"')
  expect(markup).toContain('aria-haspopup="dialog"')
  expect(sharingHint({...item,caches:[{id:'garden',name:'Garden Club'}]},cacheId)).toBe('In Garden Club')
  const selectable=render(createElement(AddItemSheet,{cacheId:'third',cacheName:'Tool Shed',dialog:createRef<HTMLDialogElement>()}))
  expect(selectable).toContain('Give · 5')
  expect(selectable).not.toContain('5 to give')
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

it('renders saved cache links on the overview and leaves attachment editing to the item editor', () => {
  const markup = render(createElement(ItemPage),{route:'/items/:itemId',path:`/items/${item.id}`})
  for (const text of ['In caches','Maple Street','Garden Club','Mark as available']) expect(markup).toContain(text)
  const sharing = markup.match(/<ul class="cc-cache-list">([\s\S]*?)<\/ul>/)![1]
  expect(sharing).toContain(`href="/caches/${cacheId}"`)
  expect(sharing).toContain('href="/caches/garden"')
  expect(sharing).not.toMatch(/<button|<input|<svg|aria-pressed|Tool Shed/)
  expect(markup).not.toContain('Confirm stop sharing')
  expect(markup).not.toContain('role="switch"')
  expect(markup).toContain(`/items/${item.id}/edit`)
  expect(markup).not.toContain('View asks in Requests')
  expect(markup).not.toContain('Delete item')
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
