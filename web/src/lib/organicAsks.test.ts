import { afterEach,expect,it,vi } from 'vitest'
import { createElement,type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter,Route,Routes } from 'react-router'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { RequestCard } from '../pages/RequestCard'
import { RequestDecision } from '../pages/RequestDecision'
import { RequestDetailPage } from '../pages/RequestDetailPage'
import { AskSheet } from '../pages/AskSheet'
import { ApprovedContact } from '../pages/RequestContact'
import { approvalBody,DEFAULT_MARK_LENT_OUT,relativeWhen,stockAfterApproval,type ItemRequest } from './requests'
import { contactAction,contactDisplayValue,type Contact,type ContactKind } from './contacts'
import type { Item } from './items'
const row:ItemRequest={id:'11111111-1111-4111-8111-111111111111',cache_id:'cache',cache_name:'Maple St. Neighbors',item_id:'item',item_title:'Cordless drill',owner_id:'owner',owner_name:'Maya',requester_id:'requester',requester_name:'Ryan',owner_cat_coat:'ginger',requester_cat_coat:'grey',quantity:null,status:'approved',decision_reason:null,approval_message:'Only the two parties see this.',created_at:1,decided_at:2}
const item:Item={id:'item',cache_id:'cache',owner_id:'owner',owner_name:'Maya',title:'Mason jars',description:null,is_consumable:true,quantity:8,available_quantity:6,available:true,photo_version:null,created_at:1}
function render(element:ReactElement,options:{caller?:string;request?:ItemRequest;contact?:Contact|null;denied?:boolean;path?:string;route?:string;item?:Item}={}){
  const caller=options.caller ?? 'requester',request=options.request ?? row
  const client=new QueryClient({defaultOptions:{queries:{retry:false,retryOnMount:false,staleTime:Infinity}}})
  client.setQueryData(['me'],{id:caller,display_name:'Ryan',email:'auth-private@example.com'})
  client.setQueryData(['request-detail',caller,row.id],request)
  client.setQueryData(['request-contact',caller,row.id],{contact:options.contact===undefined?{kind:'sms',value:'+15550142290',link:'sms:+15550142290'}:options.contact})
  if(options.denied)client.getQueryCache().find({queryKey:['request-contact',caller,row.id]})!.setState({status:'error',error:new Error('denied')})
  client.setQueryData(['item','cache','item'],options.item ?? item)
  client.setQueryData(['library-item','owner','item'],options.item ?? item)
  const children=createElement(MemoryRouter,{initialEntries:[options.path ?? '/']},createElement(Routes,null,createElement(Route,{path:options.route ?? '/',element})))
  const html=renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children})))
  client.clear();return html
}
afterEach(()=>{vi.restoreAllMocks()})
it('starts reusable approval ON with an empty message and no availability-note field',()=>{
  expect(DEFAULT_MARK_LENT_OUT).toBe(true)
  expect(approvalBody(null,'',DEFAULT_MARK_LENT_OUT)).toEqual({approval_message:'',mark_lent_out:true})
  expect(approvalBody(2,' Private ',true)).toEqual({approval_message:'Private',mark_lent_out:false})
  expect(approvalBody(null,'',false)).toEqual({approval_message:'',mark_lent_out:false})
  const html=render(createElement(RequestDecision,{request:{...row,status:'pending',approval_message:null}}),{caller:'owner'})
  expect(html).toMatch(/<input(?=[^>]*role="switch")(?=[^>]*checked="")[^>]*>/)
  expect(html).toMatch(/<textarea[^>]*><\/textarea>/)
  expect(html).toContain('Up to 500 characters')
  expect(html).not.toMatch(/approval-note-|Lent out note|200 characters/)
  expect(html).toContain('Decline with a reason')
  expect(html).not.toMatch(/Knock when|Back by Sunday|auth-private/)
})
it('omits reusable-only controls on consumable approval and offers a separate reason-required decline entry',()=>{
  const html=render(createElement(RequestDecision,{request:{...row,status:'pending',quantity:2,approval_message:null}}),{caller:'owner'})
  expect(html).not.toContain('role="switch"')
  expect(html).not.toContain('approval-note-')
  expect(html).toContain('aria-label="Decline request from Ryan"')
  expect(html).toContain('Close decision sheet')
})
it('bounds the consumable stepper by server unreserved stock and keeps reusable ask quantity absent',()=>{
  const html=render(createElement(AskSheet,{item:{...item,available_quantity:3},cacheName:'Flat 4B',onClose:()=>{}}),{item:{...item,available_quantity:3}})
  expect(html).toContain('3 to give right now')
  expect(html).toContain('min="1" max="3" step="1"')
  expect(html).toContain('aria-label="Increase ask quantity"')
  expect(html).toContain('aria-label="Decrease ask quantity"')
  expect(html).toContain('Send ask')
  expect(html).toContain('Cancel')
  const reusable=render(createElement(AskSheet,{item:{...item,is_consumable:false,quantity:null,available_quantity:null},onClose:()=>{}}),{item:{...item,is_consumable:false,quantity:null,available_quantity:null}})
  expect(reusable).not.toContain('request-quantity')
  expect(reusable).toContain('Ask Maya to borrow it?')
})
it('shows physical quantity minus this ask only to the owner, never double-subtracting the reservation',()=>{
  expect(stockAfterApproval(8,2)).toBe(6)
  const pending={...row,status:'pending' as const,quantity:2,approval_message:null}
  const owner=render(createElement(RequestCard,{request:pending,callerId:'owner'}),{caller:'owner',request:pending})
  expect(owner).toContain('6 left after this')
  expect(owner).not.toContain('4 left after this')
  const requester=render(createElement(RequestCard,{request:pending,callerId:'requester'}),{request:pending})
  expect(requester).not.toContain('left after this')
})
it('uses actual contact kind/destination and other-party name without auth email fallback',()=>{
  const links:Record<ContactKind,string>={sms:'sms:+15550142290',whatsapp:'https://wa.me/15550142290',signal:'https://signal.me/#p/+15550142290',messenger:'https://m.me/maya.example',instagram:'https://instagram.com/maya_example',email:'mailto:chosen@example.com'}
  for(const kind of Object.keys(links) as ContactKind[]){
    const contact:Contact={kind,link:links[kind],value:kind==='email'?'chosen@example.com':'+15550142290'}
    const html=render(createElement(ApprovedContact,{request:row,callerId:'requester',focused:true}),{contact})
    expect(html).toContain(`href="${links[kind]}"`)
    expect(html).toContain(contactAction(kind,'Maya'))
    expect(html).not.toContain('auth-private@example.com')
    if(links[kind].startsWith('https://'))expect(html).toContain('rel="noopener noreferrer"')
    else expect(html).not.toContain('target=')
  }
  expect(contactDisplayValue({kind:'sms',value:'+15550142290',link:links.sms})).toBe('(555) 014-2290')
})
it('focused approved history uses name art, not an item-photo grant, and keeps missing/denied contact honest',()=>{
  const options={path:`/requests/${row.id}`,route:'/requests/:requestId'}
  const html=render(createElement(RequestDetailPage),options)
  for(const text of ['Maya said yes','cc-approved-cats','cc-approved-name-art','Only the two parties','How to reach Maya','Text Maya','Shown while','Hand it off in person'])expect(html).toContain(text)
  expect(html).not.toMatch(/\/api\/caches\/.*\/photo|\/api\/me\/items\/|auth-private/)
  const denied=render(createElement(RequestDetailPage),{...options,denied:true})
  expect(denied).toContain('Only the two parties')
  expect(denied).toContain('Contact is unavailable')
  expect(denied).not.toContain('15550142290')
  const missing=render(createElement(RequestDetailPage),{...options,contact:null})
  expect(missing).toContain('hasn&#x27;t added a way to reach them yet')
  expect(missing).not.toContain('auth-private')
})
it('owner-side focused approval reveals only the requester contact and labels the owner perspective',()=>{
  const html=render(createElement(RequestDetailPage),{caller:'owner',path:`/requests/${row.id}`,route:'/requests/:requestId'})
  expect(html).toContain('You said yes to Ryan')
  expect(html).toContain('How to reach Ryan')
  expect(html).toContain('Text Ryan')
})
it('formats bounded relative times without adding a loan or due-date model',()=>{
  const now=10*86400000
  expect(relativeWhen(now-2*3600000,now)).toBe('2 hours ago')
  expect(relativeWhen(now-86400000,now)).toBe('yesterday')
  expect(relativeWhen(now-8*86400000,now)).toBe('last week')
})
