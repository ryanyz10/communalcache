import { afterEach, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { CachePage } from '../pages/CachePage'
import { HomePage } from '../pages/HomePage'
import { apiFetch, ApiError, errorMessage } from './api'

const id='11111111-1111-4111-8111-111111111111'
const cache={id,name:'Tools',owner_id:'owner',requires_approval:false,invite_token:id+'.'+'a'.repeat(43),members:[{user_id:'owner',display_name:'Neighbor'}]}

function renderPage(owner:boolean, home=false) {
  vi.stubGlobal('location',{origin:'http://127.0.0.1:8788'})
  vi.stubGlobal('sessionStorage',{getItem:()=>null})
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  client.setQueryData(['me'],{id:owner?'owner':'member',display_name:'Neighbor',email:'own@example.test'})
  client.setQueryData(['cache',id],cache)
  client.setQueryData(['caches'],[{id,name:'Tools'}])
  const page=createElement(Routes,null,createElement(Route,{path:home?'/':'/caches/:cacheId',element:createElement(home?HomePage:CachePage)}))
  const tree=createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(MemoryRouter,{initialEntries:[home?'/':`/caches/${id}`]},page)}))
  const markup=renderToStaticMarkup(tree)
  client.clear()
  return markup
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})

it('shows owner settings and confirmation controls only to the owner',()=>{
  const owner=renderPage(true)
  expect(owner).toContain('Owner settings')
  expect(owner).toContain('Rotate invite')
  expect(owner).toContain('Confirm rotation')
  expect(owner).toContain('Members (1)')
  const member=renderPage(false)
  expect(member).not.toContain('Owner settings')
  expect(member).not.toContain('>Rotate invite<')
  expect(member).toContain('Copy invite')
  expect(member).toContain(`/join/${cache.invite_token}`)
})

it('renders discovery entries and the create form on the dashboard',()=>{
  const home=renderPage(true,true)
  expect(home).toContain(`/caches/${id}`)
  expect(home).toContain('Create a cache')
  expect(home).toContain('Require owner approval to join')
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

it('distinguishes invalid names and unavailable cache data in the UI',()=>{
  expect(errorMessage(new ApiError(400,'invalid_name'))).toContain('1 and 60')
  expect(errorMessage(new ApiError(404,'not_found'))).toContain('not available')
})
