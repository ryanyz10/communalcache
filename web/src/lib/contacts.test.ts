import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { ContactLink } from '../components/ContactLink'
import { AccountPage } from '../pages/AccountPage'
import { RequestCard, RequestsPage } from '../pages/RequestsPage'
import { ApiError } from './api'
import { platforms, type Contact, type ContactKind } from './contacts'
import type { ItemRequest } from './requests'

const request: ItemRequest = {id:'ask',cache_id:'tools',cache_name:'Tools',item_id:'mixer',item_title:'Mixer',owner_id:'owner',owner_name:'Owner',requester_id:'requester',requester_name:'Requester',quantity:null,status:'approved',decision_reason:null,approval_message:'<By the gate>',created_at:1,decided_at:2}
const contact: Contact = {kind:'whatsapp',value:'+14155550148',link:'https://wa.me/14155550148'}
afterEach(()=>{vi.restoreAllMocks()})
function render(element: ReactElement, caller = 'requester', options: {own?:Contact|null;other?:Contact|null;denied?:boolean} = {}) {
  const client = new QueryClient({defaultOptions:{queries:{retry:false,retryOnMount:false}}})
  client.setQueryData(['me'],{id:caller,display_name:'Neighbor',email:'private-auth@example.test'})
  client.setQueryData(['own-contact',caller],{contact:options.own ?? null})
  client.setQueryData(['request-contact',caller,request.id],{contact:options.other === undefined ? contact : options.other})
  if(options.denied) client.getQueryCache().find({queryKey:['request-contact',caller,request.id]})!.setState({status:'error',error:new ApiError(404,'not_found')})
  client.setQueryData(['requests'],{pages:[{requests:[request],unavailable_cache_ids:[],next_cursor:null}],pageParams:[null]})
  const markup = renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(MemoryRouter,null,element)})))
  client.clear()
  return markup
}

it('renders platform icons with accessible names, exact destinations, HTTPS-only new tabs and same-window phone/email links', () => {
  const links: Record<ContactKind,string> = {sms:'sms:+14155550148',whatsapp:'https://wa.me/14155550148',signal:'https://signal.me/#p/+14155550148',messenger:'https://m.me/ryan.zhou',instagram:'https://instagram.com/ryan_zhou',email:'mailto:chosen@example.test'}
  for(const kind of Object.keys(platforms) as ContactKind[]) {
    const markup = renderToStaticMarkup(createElement(ContactLink,{contact:{kind,value:'chosen',link:links[kind]},name:'<Neighbor>'}))
    expect(markup).toContain(`href="${links[kind]}"`)
    expect(markup).toContain(`Message &lt;Neighbor&gt; on ${platforms[kind].name}`)
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).not.toContain('src=')
    if(links[kind].startsWith('https://')) { expect(markup).toContain('target="_blank"');expect(markup).toContain('rel="noopener"') }
    else {expect(markup).not.toContain('target=');expect(markup).not.toContain('rel=')}
  }
})

it('offers Account chips, kind field, save/remove and exact server-returned contact without auth email prefill', () => {
  const fetch = vi.spyOn(globalThis,'fetch')
  const markup = render(createElement(AccountPage),'requester',{own:contact})
  for(const copy of ['How to reach me','Edit contact','Platform','Text','WhatsApp','Signal','Messenger','Instagram','Email','Phone number','Save contact','Remove contact','Your sign-in email is never used','7–15 digits']) expect(markup).toContain(copy)
  expect(markup).toContain('aria-labelledby="contact-sheet-heading"')
  expect(markup).toContain('aria-controls="contact-sheet"')
  expect(markup).toContain('aria-pressed="true"')
  expect(markup).toMatch(/id="contact-value"[^>]*value=""/)
  expect(markup).not.toMatch(/id="contact-value"[^>]*value="private-auth/)
  expect(fetch).not.toHaveBeenCalled()
})

it('renders the OTHER party contact and escaped approval message in both directions, but no contact for pending/rejected or third members', () => {
  for(const caller of ['owner','requester']) {
    const markup = render(createElement(RequestCard,{request,callerId:caller}),caller)
    expect(markup).toContain(`Message ${caller==='owner'?'Requester':'Owner'} on WhatsApp`)
    expect(markup).toContain('&lt;By the gate&gt;')
    expect(markup).not.toContain('private-auth@example.test')
  }
  for(const status of ['pending','rejected'] as const) expect(render(createElement(RequestCard,{request:{...request,status},callerId:'requester'}))).not.toContain('wa.me')
  const third = render(createElement(RequestCard,{request,callerId:'third'}),'third')
  expect(third).not.toContain('wa.me');expect(third).not.toContain('By the gate')
})

it('shows missing-contact and nudge states, but never renders cached contact data after a denied refetch', () => {
  expect(render(createElement(RequestCard,{request,callerId:'requester'}),'requester',{other:null})).toContain("Owner hasn&#x27;t added a way to reach them yet")
  const denied = render(createElement(RequestCard,{request,callerId:'requester'}),'requester',{denied:true})
  expect(denied).toContain('Contact is unavailable')
  expect(denied).not.toContain('wa.me')
  expect(render(createElement(RequestsPage))).toContain('Add how to reach you')
  expect(render(createElement(RequestsPage),'requester',{own:contact})).not.toContain('Add how to reach you')
})

it('starts optional approval textarea empty with a 500-character hint, separate from required rejection reason', () => {
  const markup = render(createElement(RequestCard,{request:{...request,status:'pending',approval_message:null},callerId:'owner'}),'owner')
  expect(markup).toContain('Message (optional)')
  expect(markup).toContain('Up to 500 characters')
  expect(markup).toMatch(/<textarea[^>]*><\/textarea>/)
  expect(markup).toContain('Reason for rejection')
  expect(markup).toContain('required=""')
  expect(markup).not.toContain('By the gate')
  expect(markup).not.toContain('private-auth@example.test')
})
