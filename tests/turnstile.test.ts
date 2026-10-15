import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { requireTurnstile } from '../src/turnstile'
import { appRequest, authRequest, base, login } from './helpers'

const endpoint = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
function request(token: string | null = 'valid-token') {
  const headers = new Headers({'CF-Connecting-IP':'203.0.113.9'})
  if (token !== null) headers.set('X-Turnstile-Token',token)
  return new Request(base+'/api/caches',{method:'POST',headers})
}
function verdict(overrides: Record<string,unknown> = {}) { return {success:true,action:'signin',hostname:'communalcache.com',...overrides} }

it('posts one bounded canonical form request and strictly checks action, hostname and boolean success', async () => {
  const timeout = vi.spyOn(AbortSignal,'timeout')
  const fetch = vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json(verdict()))
  await requireTurnstile(request(),env,'signin')
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch.mock.calls[0][0]).toBe(endpoint)
  const options = fetch.mock.calls[0][1]!
  expect(options).toMatchObject({method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'}})
  expect(Object.fromEntries(new URLSearchParams(options.body as URLSearchParams))).toEqual({secret:env.TURNSTILE_SECRET,response:'valid-token',remoteip:'203.0.113.9'})
  expect(timeout).toHaveBeenCalledWith(10_000)
  expect(options.signal).toBeInstanceOf(AbortSignal)
})

it('rejects missing/oversized tokens and missing configuration without any provider call, including local configuration', async () => {
  const fetch = vi.spyOn(globalThis,'fetch')
  for (const token of [null,'','   ','x'.repeat(2049)]) await expect(requireTurnstile(request(token),env,'signin')).rejects.toMatchObject({status:403,code:'turnstile_failed'})
  for (const overrides of [{TURNSTILE_SECRET:undefined},{TURNSTILE_SECRET:''},{TURNSTILE_HOSTNAMES:undefined},{TURNSTILE_HOSTNAMES:''},{TURNSTILE_HOSTNAMES:' , '}]) {
    await expect(requireTurnstile(request(),{...env,...overrides},'signin')).rejects.toMatchObject({status:403,code:'turnstile_failed'})
  }
  expect(fetch).not.toHaveBeenCalled()
})

it('rejects wrong/missing action or hostname, false/nonboolean success, duplicate tokens and invalid provider responses', async () => {
  const fetch = vi.spyOn(globalThis,'fetch')
  for (const result of [verdict({action:'create_cache'}),verdict({action:null}),verdict({hostname:'evil.test'}),verdict({hostname:null}),verdict({hostname:'communalcache.com.evil.test'}),verdict({success:false}),verdict({success:1}),verdict({success:'true'}),{success:false,'error-codes':['timeout-or-duplicate']},null,[]]) {
    fetch.mockResolvedValueOnce(Response.json(result))
    await expect(requireTurnstile(request(),env,'signin')).rejects.toMatchObject({status:403,code:'turnstile_failed'})
  }
  fetch.mockResolvedValueOnce(new Response('invalid JSON'))
  await expect(requireTurnstile(request(),env,'signin')).rejects.toMatchObject({status:403,code:'turnstile_failed'})
  fetch.mockResolvedValueOnce(new Response('provider detail',{status:503}))
  await expect(requireTurnstile(request(),env,'signin')).rejects.toMatchObject({status:403,code:'turnstile_failed'})
  fetch.mockRejectedValueOnce(new Error('private provider error'))
  await expect(requireTurnstile(request(),env,'signin')).rejects.toMatchObject({status:403,code:'turnstile_failed'})
})

it('fails with the documented always-fail dummy secret and never relaxes claims for the always-pass dummy secret', async () => {
  const fetch = vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(Response.json({success:false}))
  await expect(requireTurnstile(request('XXXX.DUMMY.TOKEN.XXXX'),{...env,TURNSTILE_SECRET:'2x0000000000000000000000000000000AA'},'signin')).rejects.toMatchObject({status:403})
  expect(new URLSearchParams(fetch.mock.calls[0][1]?.body as URLSearchParams).get('secret')).toBe('2x0000000000000000000000000000000AA')
  fetch.mockResolvedValueOnce(Response.json({success:true,hostname:'example.com',metadata:{result_with_testing_key:true}}))
  await expect(requireTurnstile(request('XXXX.DUMMY.TOKEN.XXXX'),env,'signin')).rejects.toMatchObject({status:403})
})

it('accepts a maximum-length token and only explicitly configured hostnames, with no local or suffix bypass', async () => {
  const fetch = vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json(verdict({hostname:'staging.example.test',action:'create_cache'})))
  await requireTurnstile(request('x'.repeat(2048)),{...env,TURNSTILE_HOSTNAMES:'communalcache.com, staging.example.test'},'create_cache')
  fetch.mockResolvedValueOnce(Response.json(verdict({hostname:'localhost',action:'create_cache'})))
  await expect(requireTurnstile(request(),env,'create_cache')).rejects.toMatchObject({status:403})
})

it('rejects a replay when the provider returns timeout-or-duplicate on its second use', async () => {
  const fetch = vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(Response.json(verdict())).mockResolvedValueOnce(Response.json({success:false,'error-codes':['timeout-or-duplicate']}))
  await requireTurnstile(request(),env,'signin')
  await expect(requireTurnstile(request(),env,'signin')).rejects.toMatchObject({status:403,code:'turnstile_failed'})
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('returns 403 on siteverify timeout before any email or auth challenge is created', async () => {
  const controller = new AbortController()
  vi.spyOn(AbortSignal,'timeout').mockImplementation(ms => { expect(ms).toBe(10_000); return controller.signal })
  let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async (_url,options) => {
    started()
    return new Promise<Response>((_resolve,reject)=>options!.signal!.addEventListener('abort',()=>reject(options!.signal!.reason),{once:true}))
  })
  const pending = worker.fetch(authRequest('/sign-in/magic-link',{email:'timeout@example.test'}),env)
  await ready; controller.abort(new DOMException('Timeout','TimeoutError'))
  const response = await pending
  expect(response.status).toBe(403)
  expect(await response.json()).toEqual({error:'turnstile_failed'})
  expect(fetch).toHaveBeenCalledOnce()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM verification').first('n')).toBe(0)
})

it('gates both email sends and authenticated cache creation before side effects, and ignores body/query token forgeries', async () => {
  const caller = await login()
  await env.DB.prepare('UPDATE user SET display_name=? WHERE id=?').bind('Neighbor',caller.id).run()
  const fetch = vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({success:false}))
  fetch.mockClear()
  const paths = ['/api/auth/sign-in/magic-link','/api/auth/email-otp/send-verification-otp','/api/caches']
  for (const path of paths) {
    const input = appRequest(path,{method:'POST',cookie:caller.cookie,body:path==='/api/caches'?{name:'Protected'}:{email:'blocked@example.test',type:'sign-in'}})
    input.headers.set('X-Turnstile-Token','rejected-token')
    const response = await worker.fetch(input,env)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({error:'turnstile_failed'})
  }
  expect(fetch).toHaveBeenCalledTimes(3)
  for (const path of paths) {
    const input = appRequest(path+'?turnstileToken=forged',{method:'POST',cookie:caller.cookie,body:{email:'blocked@example.test',type:'sign-in',name:'Protected',turnstileToken:'forged'}})
    input.headers.delete('X-Turnstile-Token')
    const response = await worker.fetch(input,env)
    expect(response.status).toBe(403)
  }
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM caches').first('n')).toBe(0)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM verification').first('n')).toBe(0)
})

it('allows only matching signin/create_cache verdicts and preserves both existing handlers', async () => {
  const caller = await login()
  await env.DB.prepare('UPDATE user SET display_name=? WHERE id=?').bind('Neighbor',caller.id).run()
  let sends = 0
  vi.spyOn(globalThis,'fetch').mockImplementation(async (url,options) => {
    if (String(url) === endpoint) {
      const token = new URLSearchParams(options?.body as URLSearchParams).get('response')
      return Response.json(verdict({action:token==='cache-token'?'create_cache':'signin'}))
    }
    expect(String(url)).toBe('https://api.resend.com/emails'); sends++
    return Response.json({id:'fixture-email'})
  })
  for (const path of ['/sign-in/magic-link','/email-otp/send-verification-otp']) expect((await worker.fetch(authRequest(path,{email:'allowed@example.test',type:'sign-in'}),env)).status).toBe(200)
  const input = appRequest('/api/caches',{method:'POST',cookie:caller.cookie,body:{name:'Protected'}})
  input.headers.set('X-Turnstile-Token','cache-token')
  expect((await worker.fetch(input,env)).status).toBe(201)
  expect(sends).toBe(2)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM caches').first('n')).toBe(1)
})

it('does not gate Continue, OTP verification, sign-out, session reads or unrelated endpoints', async () => {
  const fetch = vi.spyOn(globalThis,'fetch')
  const withoutSecret = {...env,TURNSTILE_SECRET:undefined}
  const inputs = [authRequest('/get-session'),authRequest('/sign-out',{}),authRequest('/sign-in/email-otp',{email:'unknown@example.test',otp:'123456'}),authRequest('/magic-link/verify',{token:'Z'.repeat(32)}),appRequest('/api/caches'),appRequest('/api/healthz')]
  for (const input of inputs) {
    input.headers.delete('X-Turnstile-Token')
    const response = await worker.fetch(input,withoutSecret)
    expect(await response.text()).not.toContain('turnstile_failed')
  }
  expect(fetch).not.toHaveBeenCalled()
})
