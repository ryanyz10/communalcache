import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppRoutes, Ready } from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import { AppHeader } from '../components/AppHeader'
import { landingCopy } from './landingCopy'
import { ApiError, type Me } from './api'
import { destinationAfterLogin, stashJoinToken } from './pendingJoin'

const invite=`11111111-1111-4111-8111-111111111111.${'a'.repeat(43)}`
const me: Me={id:'owner',email:'own@example.test',display_name:'Ryan'}
beforeEach(()=>{
  const values=new Map<string,string>()
  vi.stubGlobal('sessionStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)})
  vi.stubGlobal('location',{origin:'https://communalcache.com',hash:'#token='+'A'.repeat(32)})
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
function render(path = '/', user: Me|null = null, state: 'ready'|'pending'|'error' = 'ready') {
  const client=new QueryClient({defaultOptions:{queries:{retry:false,retryOnMount:false}}})
  if(state!=='pending') client.setQueryData(['me'],user)
  if(state==='error') client.getQueryCache().find({queryKey:['me']})!.setState({status:'error',error:new ApiError(503,'unavailable')})
  client.setQueryData(['caches'],[])
  client.setQueryData(['library',user?.id],{pages:[{items:[],next_cursor:null}],pageParams:[null]})
  client.setQueryData(['requests'],{pages:[{requests:[],unavailable_cache_ids:[],next_cursor:null}],pageParams:[null]})
  const content=createElement(Ready,{children:createElement('div',null,createElement(AppHeader),createElement(AppRoutes))})
  const markup=renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(MemoryRouter,{initialEntries:[path]},content)})))
  client.clear()
  return markup
}

it('shows the exact mock landing copy and sign-in targets for a signed-out root without private data or a sign-in form', ()=>{
  const fetch=vi.spyOn(globalThis,'fetch'), markup=render()
  for(const copy of [landingCopy.brand,landingCopy.hero,landingCopy.description,landingCopy.howHeading,landingCopy.communityHeading,landingCopy.footer,...landingCopy.promises,...landingCopy.steps.flatMap(step=>[step.title,step.body])]) expect(markup).toContain(copy)
  expect(markup.match(/Get started, it’s free/g)).toHaveLength(2)
  expect(markup.match(/href="\/login"/g)).toHaveLength(3)
  expect(markup).toContain('href="/login?invite=1"')
  expect(markup).toContain('I have an invite link')
  expect(markup).toContain('lg:grid-cols-3')
  expect(markup).toContain('aria-labelledby="landing-heading"')
  expect(markup).toContain('data-horizon="boxes"')
  expect(markup).not.toContain('<form')
  expect(markup).not.toContain('Account menu')
  expect(fetch).not.toHaveBeenCalled()
})

it('keeps title copy centralized and hoists the root description without duplicating the static title', ()=>{
  const markup=render()
  expect(landingCopy.title).toContain(landingCopy.brand)
  expect(markup).not.toContain('<title>')
  expect(markup).toContain(`<meta name="description" content="${landingCopy.description}"/>`)
})

it('waits for session resolution and keeps session errors from becoming a landing-page flash', ()=>{
  const pending=render('/',null,'pending')
  expect(pending).toContain('Starting…');expect(pending).toContain('role="status"')
  for(const markup of [pending,render('/',null,'error')]) {
    expect(markup).not.toContain(landingCopy.hero)
    expect(markup).not.toContain(landingCopy.getStarted)
    expect(markup).not.toContain('Your caches')
  }
  expect(render('/',null,'error')).toContain('role="alert"')
})

it('keeps signed-in root Home and name onboarding unchanged', ()=>{
  const home=render('/',me)
  expect(home).toContain('Your caches');expect(home).toContain('+ New cache')
  expect(home).toContain('Account menu')
  expect(home).not.toContain(landingCopy.hero)
  const onboarding=render('/',{...me,display_name:null})
  expect(onboarding).toContain('What should neighbors call you?')
  expect(onboarding).not.toContain(landingCopy.hero)
})

it('keeps direct sign-in and invite-link explanation separate from the landing page', ()=>{
  const login=render('/login'), hint=render('/login?invite=1')
  for(const markup of [login,hint]) {
    expect(markup).toContain('Email me a sign-in link')
    expect(markup).not.toContain(landingCopy.hero)
  }
  expect(login).not.toContain(landingCopy.inviteNote)
  expect(hint).toContain(landingCopy.inviteNote)
})

it('keeps real invite and magic-link routes in their existing explicit flows, never the public landing', ()=>{
  const joining=render(`/join/${invite}`)
  expect(joining).toContain('You&#x27;re invited')
  expect(joining).toContain('Invite saved in this tab')
  expect(joining).not.toContain(landingCopy.inviteNote)
  expect(joining).not.toContain(invite)
  const memberJoin=render(`/join/${invite}`,me)
  expect(memberJoin).toContain('Join this cache')
  const magic=render('/auth/link')
  expect(magic).toContain('>Continue</button>')
  expect(magic).toContain('Opening this page does not use your link')
  for(const markup of [joining,memberJoin,magic]) expect(markup).not.toContain(landingCopy.hero)
  stashJoinToken(invite)
  expect(destinationAfterLogin()).toBe(`/join/${invite}`)
})
