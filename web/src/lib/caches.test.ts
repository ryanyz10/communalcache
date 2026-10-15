import { afterEach, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { CachePage } from '../pages/CachePage'
import { CacheSettingsPage } from '../pages/CacheSettingsPage'
import { HomePage } from '../pages/HomePage'
import { apiFetch, ApiError, errorMessage } from './api'

const id='11111111-1111-4111-8111-111111111111'
const cache={id,name:'Tools',owner_id:'owner',requires_approval:false,invite_token:id+'.'+'a'.repeat(43),members:[{user_id:'owner',display_name:'Neighbor'},{user_id:'member',display_name:'Member neighbor'}]}

function renderPage(owner:boolean, home=false, settings=false, moving=false) {
  vi.stubGlobal('location',{origin:'http://127.0.0.1:8788'})
  vi.stubGlobal('sessionStorage',{getItem:()=>null})
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  client.setQueryData(['me'],{id:owner?'owner':'member',display_name:'Neighbor',email:'own@example.test'})
  client.setQueryData(['cache',id],cache)
  client.setQueryData(['caches'],[{id,name:'Tools'}])
  client.setQueryData(['join-requests',id],[{user_id:'applicant',display_name:'New neighbor',created_at:1}])
  client.setQueryData(['requests'],{pages:[{requests:[],unavailable_cache_ids:[],next_cursor:null}],pageParams:[null]})
  const path=home?'/':settings?'/caches/:cacheId/settings':'/caches/:cacheId'
  const element=home?createElement(HomePage):settings?createElement(CacheSettingsPage,{removalDisabled:moving}):createElement(CachePage,{itemsMoving:moving})
  const page=createElement(Routes,null,createElement(Route,{path,element}))
  const tree=createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(MemoryRouter,{initialEntries:[home?'/':`/caches/${id}${settings?'/settings':''}`]},page)}))
  const markup=renderToStaticMarkup(tree)
  client.clear()
  return markup
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})

it('moves owner settings and confirmation controls to the settings page',()=>{
  const owner=renderPage(true,false,true)
  expect(owner).toContain('Cache settings')
  expect(owner).toContain('Reset link')
  expect(owner).toContain('Confirm reset')
  expect(owner).toContain('Members')
  expect(owner).toContain('Remove Member neighbor')
  expect(owner).toContain('Confirm removal')
  expect(owner).toContain('cannot rejoin with an invite')
  expect(owner).not.toContain('Remove Neighbor')
  expect(owner).toContain('Join requests')
  expect(owner).toContain('New neighbor')
  expect(owner).toContain('Approve New neighbor')
  expect(owner).toContain('Reject New neighbor')
  const member=renderPage(false,false,true)
  expect(member).not.toContain('Edit<span class="sr-only"> cache name')
  expect(member).not.toContain('Join requests')
  expect(member).not.toContain('Reset link')
  expect(member).not.toContain('Remove Member neighbor')
  expect(member).toContain('>Copy</button>')
  expect(member).toContain(`/join/${cache.invite_token}`)
})

it('renders discovery entries and a named create sheet instead of inline settings',()=>{
  const home=renderPage(true,true)
  expect(home).toContain(`/caches/${id}`)
  expect(home).toContain('+ New cache')
  expect(home).toContain('aria-labelledby="new-cache-heading"')
  expect(home).toContain('Approve new members')
  expect(home).not.toContain('Sign out')
  const detail=renderPage(true)
  expect(detail).toContain('2 members')
  expect(detail).toContain('aria-label="Cache settings"')
  expect(detail).not.toContain('Reset link')
  expect(detail).not.toContain('Confirm removal')
})

it('shows the minimal transition message without legacy item or member-removal controls',()=>{
  const cache=renderPage(true,false,false,true)
  expect(cache).toContain('Items are being moved, back soon')
  expect(cache).not.toContain('+ Add item')
  expect(cache).not.toContain('Loading items')
  const settings=renderPage(true,false,true,true)
  expect(settings).not.toContain('Remove Member neighbor')
  expect(settings).not.toContain('Confirm removal')
  expect(settings).toContain('Approve New neighbor')
  expect(settings).toContain('Reset link')
})

it('sends create/settings/rotate bodies without a forged owner or path secret',async()=>{
  const fetchMock=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>Response.json(cache))
  await apiFetch('/api/caches',{body:{name:'Tools',requires_approval:false}})
  await apiFetch(`/api/caches/${id}`,{method:'PATCH',body:{name:'Pantry',requires_approval:true}})
  await apiFetch(`/api/caches/${id}/invite/rotate`,{body:{}})
  expect(fetchMock.mock.calls.map(call=>call[0])).toEqual(['/api/caches',`/api/caches/${id}`,`/api/caches/${id}/invite/rotate`])
  expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(cache.invite_token)
  expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('owner_id')
})

it('sends owner decisions to the selected cache and applicant routes',async()=>{
  const fetchMock=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>Response.json({status:'active'}))
  await apiFetch(`/api/caches/${id}/join-requests`)
  await apiFetch(`/api/caches/${id}/join-requests/applicant/approve`,{body:{}})
  await apiFetch(`/api/caches/${id}/join-requests/applicant/reject`,{body:{}})
  expect(fetchMock.mock.calls.map(call=>call[0])).toEqual([
    `/api/caches/${id}/join-requests`,
    `/api/caches/${id}/join-requests/applicant/approve`,
    `/api/caches/${id}/join-requests/applicant/reject`,
  ])
  expect(fetchMock.mock.calls.slice(1).every(call=>call[1]?.method==='POST')).toBe(true)
})

it('sends owner member removal to the nested cache route without a body',async()=>{
  const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(null,{status:204}))
  await apiFetch(`/api/caches/${id}/members/member`,{method:'DELETE'})
  expect(fetchMock).toHaveBeenCalledWith(`/api/caches/${id}/members/member`,expect.objectContaining({method:'DELETE',credentials:'same-origin',body:undefined}))
  expect(errorMessage(new ApiError(409,'owner_cannot_be_removed'))).toContain('cannot be removed')
})

it('distinguishes invalid names and unavailable cache data in the UI',()=>{
  expect(errorMessage(new ApiError(400,'invalid_name'))).toContain('1 and 60')
  expect(errorMessage(new ApiError(404,'not_found'))).toContain('not available')
})
