import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import { CAT_COATS } from '../../../shared/cat-coats'
import { catTraits, COATS } from './cats'
import { Avatar } from '../components/Avatar'
import { CoatPicker } from '../components/CoatPicker'
import { InviteBox } from '../components/InviteBox'
import { AuthProvider } from '../auth/AuthProvider'
import { JoinPage } from '../pages/JoinPage'
import { OnboardingPage } from '../pages/OnboardingPage'
import { refreshProfileViews } from './profile'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('uses the shared six-coat contract and overrides only coat, retaining hashed personality traits', () => {
  expect(COATS.map(coat => coat.key)).toEqual(CAT_COATS)
  const base = catTraits('Mia'), chosen = catTraits('Mia','toffee')
  expect(chosen.coat.key).toBe('toffee')
  expect({ ...chosen,coat:base.coat }).toEqual(base)
  expect(catTraits('Mia',null)).toEqual(base)
  const avatar = renderToStaticMarkup(createElement(Avatar,{userId:'Mia',name:'A different name',coat:'ginger'}))
  expect(avatar).toContain('data-coat="ginger" data-pattern="Solid"')
  expect(avatar).not.toContain('<img')
})

it('offers six named native radios with a single selected coat and supports disabled saving states', () => {
  const markup = renderToStaticMarkup(createElement(CoatPicker,{userId:'Mia',value:'grey',onChange:()=>{},label:'Pick your cat'}))
  expect(markup.match(/type="radio"/g)).toHaveLength(6)
  expect(markup.match(/checked=""/g)).toHaveLength(1)
  for (const coat of COATS) expect(markup).toContain(`aria-label="${coat.name}"`)
  expect(markup).toMatch(/<input(?=[^>]*aria-label="Grey")(?=[^>]*checked="")[^>]*>/)
  expect(markup).not.toContain('email')
  expect(renderToStaticMarkup(createElement(CoatPicker,{userId:'Mia',value:null,onChange:()=>{},disabled:true}))).toContain('<fieldset disabled=""')
})

it('keeps the pre-join composition neutral and makes no preview/cache request even when private cache data is cached', () => {
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}}), fetch = vi.spyOn(globalThis,'fetch')
  const token = `11111111-1111-4111-8111-111111111111.${'A'.repeat(43)}`
  client.setQueryData(['me'],{id:'Mia',display_name:'Mia',email:'private@example.test',cat_coat:'grey'})
  client.setQueryData(['cache','11111111-1111-4111-8111-111111111111'],{name:'Never reveal',members:[{display_name:'Secret inviter'}]})
  const page = createElement(Routes,null,createElement(Route,{path:'/join/:token',element:createElement(JoinPage)}))
  const markup = renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(MemoryRouter,{initialEntries:[`/join/${token}`]},page)})))
  expect(markup).toContain('Your invitation')
  expect(markup).toContain('Ask to join')
  expect(markup).toContain('Not now')
  expect(markup).not.toMatch(/Never reveal|Secret inviter|private@example|NEIGHBORS|THINGS|AN INVITE FROM/)
  expect(fetch).not.toHaveBeenCalled()
  const scene = renderToStaticMarkup(createElement(InviteBox,{userId:'Mia'}))
  expect(scene).not.toContain('cc-cat')
  client.clear()
})

it('keeps onboarding name and coat self-bound without exposing or prefilling auth email', () => {
  const client = new QueryClient()
  client.setQueryData(['me'],{id:'Mia',display_name:null,email:'must-not-prefill@example.test',cat_coat:'oat'})
  const markup = renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(OnboardingPage)})))
  expect(markup).toContain('HELLO, MY NAME IS')
  expect(markup).toContain('Your name')
  expect(markup).toContain('data-coat="oat"')
  expect(markup).toContain('for="display_name"')
  expect(markup.match(/type="radio"/g)).toHaveLength(6)
  expect(markup).not.toContain('must-not-prefill')
  client.clear()
})

it('refreshes identity and scoped display queries rather than restoring a stale profile response', async () => {
  const client = new QueryClient(), invalidate = vi.spyOn(client,'invalidateQueries').mockResolvedValue()
  await refreshProfileViews(client)
  for (const key of ['me','cache','join-requests','requests','item','items','item-requests','library','library-item']) expect(invalidate).toHaveBeenCalledWith({queryKey:[key]})
  client.clear()
})

it('defines the exported page geometry, scrollable six-coat row and ink primary/label contrast fixes', () => {
  const css = readFileSync(new URL('../profile.css',import.meta.url),'utf8')
  expect(css).toContain('grid-template-columns: minmax(0,1.1fr) minmax(0,1fr)')
  expect(css).toContain('grid-template-columns: minmax(0,1.15fr) minmax(0,1fr)')
  expect(css).toContain('overflow-x: auto')
  expect(css).toContain('padding-top: max(48px,calc((100dvh - 447px)/2))')
  expect(css).toContain('background: var(--cc-accent); color: #201e1d')
  expect(css).toContain('color: #201e1d; border-color: rgba(32,30,29,.4)')
  expect(css).not.toMatch(/https?:\/\//)
})
