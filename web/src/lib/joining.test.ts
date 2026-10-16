import { afterEach, beforeEach, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { JoinPage } from '../pages/JoinPage'
import { ApiError, apiFetch, errorMessage, type Me } from './api'
import { joinFromToken } from './joining'
import { destinationAfterLogin, peekJoinToken, stashJoinToken } from './pendingJoin'

const id = '11111111-1111-4111-8111-111111111111'
const secret = 'a'.repeat(42) + 'A'
const token = `${id}.${secret}`
const mutation = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('@tanstack/react-query', async importOriginal => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useMutation: () => ({ isSuccess: false, isError: false, isPending: false, mutate: vi.fn(), ...mutation.state }) }
})

beforeEach(() => {
  mutation.state = {}
  const values = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
  const shared = new Map<string,string>()
  vi.stubGlobal('localStorage', {getItem:(key:string)=>shared.get(key)??null,setItem:(key:string,value:string)=>{shared.set(key,value)},removeItem:(key:string)=>{shared.delete(key)}})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function renderJoin(me: Me | null, invite = token) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['me'], me)
  const page = createElement(Routes, null, createElement(Route, { path: '/join/:token', element: createElement(JoinPage) }))
  const tree = createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, { initialEntries: [`/join/${invite}`] }, page) }))
  const markup = renderToStaticMarkup(tree)
  client.clear()
  return markup
}
const me = { id: 'caller', email: 'own@example.test', display_name: 'Neighbor' }

it('keeps login and name onboarding on the invite page, then offers a join action', () => {
  const signedOut = renderJoin(null)
  expect(signedOut).toContain('You&#x27;re invited')
  expect(signedOut).toContain('Invite saved on this browser')
  expect(signedOut).toContain('Email me a sign-in link')
  expect(signedOut).toContain('Use a 6-digit code instead')
  expect(signedOut.indexOf('Invite saved on this browser')).toBeLessThan(signedOut.indexOf('<form'))
  expect(signedOut).not.toContain(secret)
  expect(renderJoin({ ...me, display_name: null })).toContain('What should neighbors call you?')
  expect(renderJoin(me)).toContain('Ask to join')
  expect(renderJoin(me)).toContain('Your invitation')
  expect(renderJoin(me)).not.toContain('AN INVITE FROM')
  expect(renderJoin(me, 'bad-token')).toContain('Invalid invite link')
})

it('renders active and pending results without leaking the invite or email', () => {
  mutation.state = { isSuccess: true, data: { cache_id: id, name: 'Tools', status: 'active' } }
  const active = renderJoin(me)
  expect(active).toContain('Welcome to Tools')
  expect(active).toContain(`/caches/${id}`)
  expect(active).not.toContain(secret)
  expect(active).not.toContain(me.email)
  mutation.state = { isSuccess: true, data: { cache_id: id, name: 'Tools', status: 'pending' } }
  const pending = renderJoin(me)
  expect(pending).toContain('Waiting for owner approval')
  expect(pending).toContain('Your request to join Tools is saved')
  expect(pending).not.toContain('Open cache')
})

it('retains the invite across code/name onboarding and failures, then POSTs only the secret and clears storage', async () => {
  stashJoinToken(token)
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ success: true }))
  await apiFetch('/api/auth/email-otp/send-verification-otp', { body: { email: me.email, type: 'sign-in' } })
  await apiFetch('/api/auth/sign-in/email-otp', { body: { email: me.email, otp: '123456' } })
  await apiFetch('/api/me', { method: 'PATCH', body: { display_name: me.display_name } })
  expect(destinationAfterLogin()).toBe(`/join/${token}`)
  expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(secret)
  fetchMock.mockResolvedValue(Response.json({ error: 'not_found' }, { status: 404 }))
  await expect(joinFromToken(token)).rejects.toThrow('not_found')
  expect(peekJoinToken()).toBe(token)
  const result = { cache_id: id, name: 'Tools', status: 'pending' }
  fetchMock.mockResolvedValue(Response.json(result))
  expect(await joinFromToken(token)).toEqual(result)
  expect(fetchMock).toHaveBeenLastCalledWith(`/api/caches/${id}/join`, expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: JSON.stringify({ secret }) }))
  expect(fetchMock.mock.calls.every(call => !String(call[0]).includes(secret))).toBe(true)
  expect(peekJoinToken()).toBeNull()
  expect(sessionStorage.getItem('cc_pending_join')).toBeNull()
  expect(localStorage.getItem('cc_pending_join')).toBeNull()
  expect(destinationAfterLogin()).toBe('/')
})

it('shows removed-member and lost-decision errors rather than hiding them behind generic failures', () => {
  mutation.state = { isError: true, error: new ApiError(403, 'member_removed') }
  expect(renderJoin(me)).toContain('cannot rejoin with an invite')
  expect(errorMessage(new ApiError(409, 'join_not_pending'))).toContain('already been decided')
})
