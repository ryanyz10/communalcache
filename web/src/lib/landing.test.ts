import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppRoutes, Ready } from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import { AppHeader } from '../components/AppHeader'
import { landingCopy, SOURCE_CODE_URL } from './landingCopy'
import { readFileSync } from 'node:fs'
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
  expect(markup).toContain('cc-landing-shelf')
  expect(markup).toContain('cc-landing-packing-slip')
  expect(markup).toContain('There&#x27;s room in the box.')
  for(const box of landingCopy.shelf) expect(markup).toContain(box.label)
  for(const box of landingCopy.shelf) for(const cat of box.cats) expect(cat.id).not.toContain('@')
  expect(markup.match(/class="cc-landing-box cc-landing-box-/g)).toHaveLength(7)
  expect(markup).toContain('class="cc-landing-shelf" aria-hidden="true"')
  expect(markup).toContain('aria-labelledby="landing-heading"')
  expect(markup).not.toContain('data-horizon=')
  expect(markup).toContain('viewBox="0 0 32 32"')
  expect(markup).not.toContain('<form')
  expect(markup).not.toContain('Account menu')
  expect(fetch).not.toHaveBeenCalled()
})

it('links the header GitHub mark to source with an accessible new-tab notice and 44px target', () => {
  const header = render().match(/<header class="cc-landing-header">([\s\S]*?)<\/header>/)![1]
  const link = header.match(/<a\b(?=[^>]*class="cc-landing-source")([^>]*)>([\s\S]*?)<\/a>/)!
  expect(SOURCE_CODE_URL).toBe('https://github.com/ryanyz10/communalcache')
  expect(link[1]).toContain(`href="${SOURCE_CODE_URL}"`)
  expect(link[1]).toContain('target="_blank"')
  expect(link[1]).toContain('rel="noopener noreferrer"')
  expect(link[2]).toContain(`${landingCopy.sourceCode} ${landingCopy.opensNewTab}`)
  expect(link[2]).toContain('class="sr-only"')
  expect(link[2]).toContain('fill="currentColor" aria-hidden="true" focusable="false"')
  expect(link[2]).not.toContain('<img')
  const css = readFileSync(new URL('../landing.css', import.meta.url), 'utf8')
  const target = css.match(/\.cc-landing-source \{([^}]+)\}/)![1]
  expect(target).toContain('min-width: 44px')
  expect(target).toContain('min-height: 44px')
  expect(target).toContain('var(--cc-sub)')
})

it('keeps title copy centralized and hoists the root description without duplicating the static title', ()=>{
  const markup=render()
  expect(landingCopy.title).toContain(landingCopy.brand)
  expect(markup).not.toContain('<title>')
  expect(markup).toContain(`<meta name="description" content="${landingCopy.description}"/>`)
})

it('waits for session resolution and keeps session errors from becoming a landing-page flash', ()=>{
  const pending=render('/',null,'pending')
  expect(pending).toContain('cc-neutral-loading');expect(pending).toContain('class="sr-only">Loading…');expect(pending).toContain('role="status"')
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
  expect(home).toContain('Desktop navigation')
  expect(home).toContain('Mobile navigation')
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
  expect(joining).toContain('Invite saved on this browser')
  expect(joining).not.toContain(landingCopy.inviteNote)
  expect(joining).not.toContain(invite)
  const memberJoin=render(`/join/${invite}`,me)
  expect(memberJoin).toContain('There&#x27;s room in the box for you.')
  const magic=render('/auth/link')
  expect(magic).toContain('>Continue</button>')
  expect(magic).toContain('Opening this page does not use your link')
  for(const markup of [joining,memberJoin,magic]) expect(markup).not.toContain(landingCopy.hero)
  stashJoinToken(invite)
  expect(destinationAfterLogin()).toBe(`/join/${invite}`)
})
