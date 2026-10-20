import { afterEach, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { sendAuthMail } from '../src/auth-mail'
import { localDevAuth } from '../src/local-dev'
import { requireTurnstile } from '../src/turnstile'

const origin='http://localhost:8787', endpoint='https://challenges.cloudflare.com/turnstile/v0/siteverify'
const mail={to:['local@example.test'],subject:'Sign in',text:'The code is 123456'}
const config={LOCAL_DEV_AUTH:'1',RESEND_API_KEY:'',EMAIL_FROM:'Local <local@example.test>'}
afterEach(()=>vi.restoreAllMocks())

it.each(['http://localhost:8787','http://127.0.0.1:8787','http://[::1]:8787'])('logs the actual mail text and skips Resend only with opt-in, empty key and loopback URL %s',async url=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{}), fetch=vi.spyOn(globalThis,'fetch')
  await sendAuthMail(config,url,mail)
  expect(log).toHaveBeenCalledOnce()
  expect(log.mock.calls[0][0]).toContain('To: local@example.test')
  expect(log.mock.calls[0][0]).toContain(mail.text)
  expect(fetch).not.toHaveBeenCalled()
})

it('never logs when the opt-in or actual local request URL is missing, malformed or non-local; empty-key delivery fails closed',async()=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{}), fetch=vi.spyOn(globalThis,'fetch')
  for (const flag of [undefined,'','true','0']) await expect(sendAuthMail({...config,LOCAL_DEV_AUTH:flag},origin,mail)).rejects.toThrow('not configured')
  for (const url of [undefined,'','invalid','https://communalcache.com','http://localhost.evil.test','http://sub.localhost','http://localhost.']) {
    expect(localDevAuth(config,url)).toBe(false)
    await expect(sendAuthMail(config,url,mail)).rejects.toThrow('not configured')
  }
  expect(log).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
})

it('uses the unchanged bounded Resend request if a key is present, even with local opt-in',async()=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{})
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({id:'mail'}))
  await sendAuthMail({...config,RESEND_API_KEY:'test-only'},origin,mail)
  expect(log).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledWith('https://api.resend.com/emails',expect.objectContaining({method:'POST',redirect:'manual',signal:expect.any(AbortSignal)}))
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({from:config.EMAIL_FROM,...mail})
  fetch.mockResolvedValueOnce(new Response('provider error',{status:503}))
  await expect(sendAuthMail({...config,RESEND_API_KEY:'test-only'},origin,mail)).rejects.toThrow('Could not send sign-in email')
})

it('accepts public testing-key verdicts only after Siteverify with explicit local mode and a loopback request',async()=>{
  const verdict={success:true,hostname:'example.com',metadata:{result_with_testing_key:true}}
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>Response.json(verdict))
  const bindings={...config,TURNSTILE_SECRET:'public-test-secret',TURNSTILE_HOSTNAMES:'localhost'}
  const request=(url=origin)=>new Request(url+'/api/auth/sign-in/magic-link',{method:'POST',headers:{'X-Turnstile-Token':'XXXX.DUMMY.TOKEN.XXXX'}})
  for (const host of ['http://localhost:8787','http://127.0.0.1:8787','http://[::1]:8787']) await requireTurnstile(request(host),bindings,'signin')
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(fetch.mock.calls.every(call=>call[0]===endpoint && call[1]?.redirect==='manual')).toBe(true)
  for (const bindings of [{...config,LOCAL_DEV_AUTH:undefined},{...config,LOCAL_DEV_AUTH:'true'}]) {
    await expect(requireTurnstile(request(),{...bindings,TURNSTILE_SECRET:'test',TURNSTILE_HOSTNAMES:'localhost'},'signin')).rejects.toMatchObject({status:403})
  }
  await expect(requireTurnstile(request('https://communalcache.com'),bindings,'signin')).rejects.toMatchObject({status:403})
  for (const response of [{success:false,metadata:{result_with_testing_key:true}},{success:true},{success:true,metadata:{result_with_testing_key:'true'}}]) {
    fetch.mockResolvedValueOnce(Response.json(response))
    await expect(requireTurnstile(request(),bindings,'signin')).rejects.toMatchObject({status:403})
  }
  fetch.mockResolvedValueOnce(Response.json({success:true,action:'signin',hostname:'localhost',metadata:{result_with_testing_key:true}}))
  await expect(requireTurnstile(request(),{...bindings,LOCAL_DEV_AUTH:undefined},'signin')).rejects.toMatchObject({status:403})
})

function localRequest(path:string,body:unknown) {
  return new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Turnstile-Token':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify(body)})
}
const local={...env,...config,APP_BASE_URL:origin,BETTER_AUTH_URL:origin,TURNSTILE_HOSTNAMES:'localhost',ASSETS:{fetch:async()=>new Response('<landing/>')}} as unknown as Env

it('the logged six-digit code verifies through normal Worker/Better Auth/D1 with hashed challenge and a real session',async()=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{})
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async url=>{
    expect(String(url)).toBe(endpoint)
    return Response.json({success:true,hostname:'example.com',metadata:{result_with_testing_key:true}})
  })
  const sent=await worker.fetch(localRequest('/api/auth/email-otp/send-verification-otp',{email:'local@example.test',type:'sign-in'}),local)
  expect(sent.status).toBe(200)
  const text=log.mock.calls.flat().join('\n'), code=text.match(/sign-in code is (\d{6})/)![1]
  expect(JSON.stringify((await env.DB.prepare('SELECT value FROM verification').all()).results)).not.toContain(code)
  const verified=await worker.fetch(localRequest('/api/auth/sign-in/email-otp',{email:'local@example.test',otp:code}),local)
  expect(verified.status).toBe(200)
  const cookie=verified.headers.get('Set-Cookie')!.split(';')[0]
  const me=await worker.fetch(new Request(origin+'/api/me',{headers:{Cookie:cookie}}),local)
  expect(me.status).toBe(200)
  expect(await me.json()).toMatchObject({email:'local@example.test',display_name:null})
  expect(fetch).toHaveBeenCalledOnce()
})

it('logs the same magic landing URL, keeps landing GET non-consuming and requires explicit Continue POST',async()=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{})
  vi.spyOn(globalThis,'fetch').mockImplementation(async url=>{
    expect(String(url)).toBe(endpoint)
    return Response.json({success:true,hostname:'example.com',metadata:{result_with_testing_key:true}})
  })
  expect((await worker.fetch(localRequest('/api/auth/sign-in/magic-link',{email:'link@example.test',callbackURL:'/'}),local)).status).toBe(200)
  const link=log.mock.calls.flat().join('\n').match(/http:\/\/localhost:8787\/auth\/link#[^\s]+/)![0]
  const url=new URL(link), token=new URLSearchParams(url.hash.slice(1)).get('token')!
  const before=(await env.DB.prepare('SELECT value FROM verification').all()).results
  expect(JSON.stringify(before)).not.toContain(token)
  expect((await worker.fetch(new Request(url.origin+url.pathname),local)).status).toBe(200)
  expect((await env.DB.prepare('SELECT value FROM verification').all()).results).toEqual(before)
  const verified=await worker.fetch(localRequest('/api/auth/magic-link/verify',{token,callbackURL:'/'}),local)
  expect(verified.status).toBe(200)
  expect(verified.headers.get('Set-Cookie')).toBeTruthy()
})
