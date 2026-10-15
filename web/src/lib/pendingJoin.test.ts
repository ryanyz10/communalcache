import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '../auth/AuthProvider'
import { HomePage } from '../pages/HomePage'
import { clearJoinToken, destinationAfterLogin, parseInvite, peekJoinToken, PENDING_JOIN_TTL_MS, stashJoinToken } from './pendingJoin'

const token=`11111111-1111-4111-8111-111111111111.${'a'.repeat(42)}A`, other=`22222222-2222-4222-8222-222222222222.${'B'.repeat(43)}`
const key='cc_pending_join'
let session: Map<string,string>, local: Map<string,string>
function storage(values: Map<string,string>) {return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}}
beforeEach(()=>{
  session=new Map();local=new Map()
  vi.stubGlobal('sessionStorage',storage(session));vi.stubGlobal('localStorage',storage(local))
  vi.stubGlobal('navigator',{});vi.stubGlobal('location',{origin:'https://communalcache.com'})
  vi.spyOn(Date,'now').mockReturnValue(1_000_000)
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})

it('parses bare codes, local paths and HTTP(S) invite URLs from production, staging or local origins without navigating to that origin', ()=>{
  for(const input of [token,` ${token} `,`/join/${token}`,`/join/${token}/`,`https://communalcache.com/join/${token}`,`https://staging.example.test/join/${token}`,`http://127.0.0.1:8787/join/${token}/`]) expect(parseInvite(input)).toBe(token)
  expect(parseInvite(token.toUpperCase())).toBe(token.toUpperCase())
})

it('rejects junk, non-invite routes, unsupported schemes, credentials, encoded secrets and callback/query injection', ()=>{
  for(const input of ['', 'bad','cache.secret',token.slice(0,-1),`${token}?next=x`,`/join/${token}?next=https://evil.test`,`https://host.test/join/${token}#x`,`https://user:pass@host.test/join/${token}`,`//host.test/join/${token}`,`javascript:/join/${token}`,`data:text/plain,/join/${token}`,`https://host.test/items/${token}`,`https://host.test/join/${token.replace('A','%41')}`,`https://host.test/\\join/${token}`,'x'.repeat(2049)]) expect(parseInvite(input),input).toBeNull()
})

it('recovers in a new tab with empty session storage, expires at one hour and removes expired records', ()=>{
  stashJoinToken(token)
  expect(JSON.parse(local.get(key)!)).toEqual({token,expiresAt:Date.now()+PENDING_JOIN_TTL_MS})
  session.clear()
  expect(peekJoinToken()).toBe(token)
  expect(destinationAfterLogin()).toBe(`/join/${token}`)
  vi.mocked(Date.now).mockReturnValue(1_000_000+PENDING_JOIN_TTL_MS)
  expect(peekJoinToken()).toBeNull()
  expect(local.has(key)).toBe(false)
  expect(destinationAfterLogin()).toBe('/')
})

it('expires and clears both the current-tab and shared records together', ()=>{
  stashJoinToken(token)
  vi.mocked(Date.now).mockReturnValue(1_000_000+PENDING_JOIN_TTL_MS)
  expect(peekJoinToken()).toBeNull()
  expect(session.has(key)).toBe(false);expect(local.has(key)).toBe(false)
})

it('prioritizes a valid explicit relative invite callback over storage, with local fallback only for valid fresh tokens', ()=>{
  stashJoinToken(token)
  expect(destinationAfterLogin(`/join/${other}`)).toBe(`/join/${other}`)
  session.clear()
  for(const callback of [undefined,'/',`https://communalcache.com/join/${other}`,`https://evil.test/join/${other}`,`//evil.test/join/${other}`,`/join/${other}?next=x`,`/join/${other}#x`,`/join/${other}/`, '/requests']) expect(destinationAfterLogin(callback)).toBe(`/join/${token}`)
  clearJoinToken()
  expect(destinationAfterLogin(`/join/${other}`)).toBe(`/join/${other}`)
  expect(destinationAfterLogin('https://evil.test')).toBe('/')
})

it('clears both stores after completion/cancel but does not erase a newer invite from another tab', ()=>{
  stashJoinToken(token)
  local.set(key,JSON.stringify({token:other,expiresAt:Date.now()+PENDING_JOIN_TTL_MS}))
  clearJoinToken(token)
  expect(session.has(key)).toBe(false)
  expect(peekJoinToken()).toBe(other)
  clearJoinToken()
  expect(session.has(key)).toBe(false);expect(local.has(key)).toBe(false)
})

it('ignores malformed, legacy, non-token and unbounded-expiry storage records', ()=>{
  for(const raw of ['not json',token,JSON.stringify({token:'https://evil.test',expiresAt:Date.now()+1}),JSON.stringify({token,expiresAt:'later'}),JSON.stringify({token,expiresAt:Date.now()+2*PENDING_JOIN_TTL_MS})]) {
    local.set(key,raw)
    expect(peekJoinToken()).toBeNull();expect(local.has(key)).toBe(false)
  }
})

it('keeps same-tab fallback when local storage is unavailable and uses local storage when session storage is unavailable', ()=>{
  vi.stubGlobal('localStorage',{getItem:()=>{throw new Error('blocked')},setItem:()=>{throw new Error('blocked')},removeItem:()=>{throw new Error('blocked')}})
  stashJoinToken(token);expect(peekJoinToken()).toBe(token)
  vi.stubGlobal('localStorage',storage(local));vi.stubGlobal('sessionStorage',{})
  stashJoinToken(other);expect(peekJoinToken()).toBe(other)
  vi.stubGlobal('localStorage',{})
  expect(()=>stashJoinToken(token)).toThrow('Could not save invite')
  expect(peekJoinToken()).toBeNull();expect(()=>clearJoinToken()).not.toThrow()
})

it('clears pending invites only after successful sign-out', async ()=>{
  stashJoinToken(token)
  const client=new QueryClient();client.setQueryData(['me'],{id:'caller',display_name:'Neighbor',email:'own@example.test'})
  let signOut!:()=>Promise<void>
  function Probe(){signOut=useAuth().signOut;return null}
  renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(Probe)})))
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(Response.json({error:'unavailable'},{status:503}))
  await expect(signOut()).rejects.toThrow()
  expect(peekJoinToken()).toBe(token)
  fetch.mockResolvedValueOnce(Response.json({success:true}))
  await signOut()
  expect(session.has(key)).toBe(false);expect(local.has(key)).toBe(false)
  client.clear()
})

it('offers the native paste sheet near New cache and in the empty state without starting a join', ()=>{
  const client=new QueryClient();client.setQueryData(['me'],{id:'caller',display_name:'Neighbor',email:'own@example.test'});client.setQueryData(['caches'],[])
  const fetch=vi.spyOn(globalThis,'fetch')
  const markup=renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(MemoryRouter,null,createElement(HomePage))})))
  expect(markup.match(/>Join with an invite<\/button>/g)).toHaveLength(2)
  expect(markup).toContain('aria-labelledby="join-invite-heading"')
  expect(markup).toContain('Invite link or code')
  expect(markup).toContain('Open invite')
  expect(fetch).not.toHaveBeenCalled()
  client.clear()
})
