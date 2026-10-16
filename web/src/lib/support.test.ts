import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { AppFooter, SupportCard } from '../components/Support'
import { AccountPage } from '../pages/AccountPage'
import { LandingPage } from '../pages/LandingPage'
import { landingCopy } from './landingCopy'
import { SUPPORT_URL } from './support'

beforeEach(() => { vi.stubGlobal('navigator',{}); vi.stubGlobal('location',{origin:'https://communalcache.com'}) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.doUnmock('./support') })
function render(path: string, signedIn = true, account = false) {
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}})
  client.setQueryData(['me'],signedIn?{id:'caller',display_name:'Neighbor',email:'private@example.test'}:null)
  const content=createElement('div',null,account?createElement(AccountPage):null,createElement(AppFooter))
  const markup=renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(MemoryRouter,{initialEntries:[path]},content)})))
  client.clear()
  return markup
}
function links(markup: string) { return markup.match(/<a\b[^>]*href="https:\/\/buymeacoffee\.com\/ryanyz10"[^>]*>/g)??[] }
function safeLink(markup: string) {
  expect(markup).toContain('href="https://buymeacoffee.com/ryanyz10"')
  expect(markup).toContain('target="_blank"')
  expect(markup).toContain('rel="noopener noreferrer"')
}

it('renders the exact owner-approved hosted URL and copy without tracking, widgets, scripts or requests', () => {
  const fetch=vi.spyOn(globalThis,'fetch'), markup=renderToStaticMarkup(createElement(SupportCard))
  expect(SUPPORT_URL).toBe('https://buymeacoffee.com/ryanyz10')
  const url=new URL(SUPPORT_URL)
  expect(url.protocol).toBe('https:');expect(url.search).toBe('');expect(url.hash).toBe('')
  for(const copy of Object.values(landingCopy.support)) expect(markup).toContain(copy)
  expect(links(markup)).toHaveLength(1)
  safeLink(links(markup)[0]!)
  expect(markup).toContain('opens in a new tab')
  expect(markup).not.toMatch(/<script\b|<iframe\b|<img\b|data-bmc|widget\.buymeacoffee/i)
  expect(fetch).not.toHaveBeenCalled()
})

it('shows one quiet footer on signed-in routes without app identity and keeps auth/signed-out pages clean', () => {
  for(const path of ['/','/requests','/items','/caches/cache-id','/account']) {
    const markup=render(path)
    expect(links(markup)).toHaveLength(1)
    safeLink(links(markup)[0]!)
    expect(markup).toContain('cc-support-footer')
    expect(markup).not.toContain('private@example.test')
    expect(markup).not.toContain('caller')
  }
  for(const path of ['/login','/auth/link']) expect(links(render(path))).toHaveLength(0)
  expect(links(render('/',false))).toHaveLength(0)
})

it('places the Account card and landing footer link in their actual page markup without loading the provider', () => {
  const fetch=vi.spyOn(globalThis,'fetch')
  const account=render('/account',true,true)
  expect(account).toContain('aria-labelledby="support-heading"')
  expect(account).toContain(landingCopy.support.description)
  expect(links(account)).toHaveLength(2)
  links(account).forEach(safeLink)
  const landing=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(LandingPage)))
  expect(links(landing)).toHaveLength(1)
  safeLink(links(landing)[0]!)
  expect(landing).not.toMatch(/<script\b|<iframe\b/i)
  expect(fetch).not.toHaveBeenCalled()
})

it('hides the link and Account card when the single URL constant is unconfigured', async () => {
  vi.resetModules()
  vi.doMock('./support',()=>({SUPPORT_URL:''}))
  const disabled=await import('../components/Support')
  expect(renderToStaticMarkup(createElement(disabled.SupportLink))).toBe('')
  expect(renderToStaticMarkup(createElement(disabled.SupportCard))).toBe('')
})
