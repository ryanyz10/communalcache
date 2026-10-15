import { expect, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { createAuth } from '../src/auth'
import worker from '../src/index'

export const base = 'https://communalcache.com'
let nextIP = 0
export function authRequest(path: string, body?: unknown, ip = `192.0.2.${++nextIP}`) {
  return new Request(base + '/api/auth' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Origin: base, 'Content-Type': 'application/json', 'cf-connecting-ip': ip, ...(['/sign-in/magic-link','/email-otp/send-verification-otp'].includes(path) ? {'X-Turnstile-Token':'fixture-signin'} : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
}
export function turnstileMock(input: RequestInfo | URL, init?: RequestInit) {
  if (String(input) !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return
  const body = new URLSearchParams(init?.body as URLSearchParams)
  const token = body.get('response')
  expect(['fixture-signin','fixture-create-cache']).toContain(token)
  return Response.json({success:true,action:token==='fixture-signin'?'signin':'create_cache',hostname:'communalcache.com'})
}
export function mailMock() {
  const codes: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const verified = turnstileMock(input,init)
    if (verified) return verified
    expect(input).toBe('https://api.resend.com/emails')
    expect(init?.redirect).toBe('manual')
    const body = JSON.parse(init!.body as string) as { text: string }
    codes.push(body.text.match(/\b\d{6}\b/)![0])
    return Response.json({ id: 'mock-mail' })
  })
  return codes
}
export async function send(email: string) {
  const res = await createAuth(env).handler(authRequest('/email-otp/send-verification-otp', { email, type: 'sign-in' }))
  expect(res.status).toBe(200)
}
export function redeem(email: string, otp: string) {
  return createAuth(env).handler(authRequest('/sign-in/email-otp', { email, otp }))
}
export async function login(email = 'caller@example.test') {
  const codes = mailMock()
  const sendResponse = await worker.fetch(authRequest('/email-otp/send-verification-otp', { email, type: 'sign-in' }), env)
  expect(sendResponse.status).toBe(200)
  const response = await worker.fetch(authRequest('/sign-in/email-otp', {email, otp: codes[0]}), env)
  expect(response.status).toBe(200)
  const data = await response.json() as {user: {id: string}; token: string}
  return { id: data.user.id, token: data.token, cookie: response.headers.get('Set-Cookie')!.split(';')[0], setCookie: response.headers.get('Set-Cookie')! }
}
export function appRequest(path: string, options: {method?: string; body?: unknown; cookie?: string; origin?: string | null} = {}) {
  const headers = new Headers()
  if (options.cookie) headers.set('Cookie', options.cookie)
  if (path === '/api/caches' && options.method === 'POST') headers.set('X-Turnstile-Token','fixture-create-cache')
  if (options.origin !== null) headers.set('Origin', options.origin ?? base)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  return new Request(base + path, {method: options.method ?? 'GET', headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined})
}
