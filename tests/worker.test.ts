import { it, expect, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import worker, { requireProfile } from '../src/index'
import { HttpError } from '../src/http'
import { authOptions, createAuth } from '../src/auth'
import { appRequest, authRequest, login, base, mailMock, turnstileMock } from './helpers'

it('serves health/config without secrets and keeps unknown APIs JSON', async () => {
  expect(await (await worker.fetch(appRequest('/api/healthz'), env)).json()).toEqual({status: 'ok'})
  const config = await (await worker.fetch(appRequest('/api/config'), env)).json()
  expect(config).toEqual({app_base_url: base, better_auth_url: base, vapid_public_key: '',turnstile_site_key:env.TURNSTILE_SITE_KEY})
  for (const path of ['/api', '/api/missing', '/api/auth/missing']) {
    const res = await worker.fetch(appRequest(path), env)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({error: 'not_found'})
  }
  expect((await worker.fetch(appRequest('/api/me'), env)).status).toBe(401)
  expect((await worker.fetch(appRequest('/api/healthz', {method: 'POST'}), env)).status).toBe(405)
})

it('serves SPA deep links and no-referrer invite responses', async () => {
  const assets = {fetch: vi.fn(async () => new Response('<!doctype html><div id="root"></div>', {headers: {'Content-Type': 'text/html'}}))} as unknown as Fetcher
  const response = await worker.fetch(appRequest('/join/cache.secret'), {...env, ASSETS: assets})
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(await response.text()).toContain('id="root"')
  expect((await worker.fetch(appRequest('/nested/page'), {...env, ASSETS: assets})).status).toBe(200)
})

it('profiles remain nullable, names are caller-scoped, and forged identities cannot write', async () => {
  const caller = await login()
  await env.DB.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?,?,?,?,?,?,?)')
    .bind('other-user','', 'other@example.test',1,new Date().toISOString(),new Date().toISOString(),'Other').run()
  const me = await (await worker.fetch(appRequest('/api/me', {cookie: caller.cookie}), env)).json()
  expect(me).toEqual({id:caller.id,email:'caller@example.test',display_name:null,cat_coat:null,profile_photo_version:null})
  const patch = await worker.fetch(appRequest('/api/me', {method: 'PATCH', cookie: caller.cookie, body: {display_name: '  Neighbor  ', id: 'other-user', email: 'forged@example.test'}}), env)
  expect(await patch.json()).toEqual({id:caller.id,email:'caller@example.test',display_name:'Neighbor',cat_coat:null,profile_photo_version:null})
  expect(await env.DB.prepare('SELECT display_name FROM user WHERE id = ?').bind('other-user').first('display_name')).toBe('Other')
  for (const display_name of ['', ' '.repeat(3), 'x'.repeat(61), null, 4]) {
    expect((await worker.fetch(appRequest('/api/me', {method:'PATCH', cookie: caller.cookie, body:{display_name}}), env)).status).toBe(400)
  }
})

it('auth signup fields cannot set the community display name', async () => {
  const codes = mailMock()
  expect((await worker.fetch(authRequest('/email-otp/send-verification-otp', {email: 'new@example.test', type: 'sign-in'}), env)).status).toBe(200)
  const forged = await worker.fetch(authRequest('/sign-in/email-otp', {
    email: 'new@example.test', otp: codes[0], name: 'Auth core name', display_name: 'Forged profile',
  }), env)
  expect(forged.status).toBe(400)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user').first('n')).toBe(0)
  expect((await worker.fetch(authRequest('/email-otp/send-verification-otp', {email: 'core@example.test', type: 'sign-in'}), env)).status).toBe(200)
  const response = await worker.fetch(authRequest('/sign-in/email-otp', {
    email: 'core@example.test', otp: codes[1], name: 'Auth core name',
  }), env)
  expect(response.status).toBe(200)
  const cookie = response.headers.get('Set-Cookie')!.split(';')[0]
  const profile = await (await worker.fetch(appRequest('/api/me', {cookie}), env)).json() as {display_name: string | null}
  expect(profile.display_name).toBeNull()
})

it('profile gating ignores core names and exempts auth, push, and onboarding', () => {
  const profile = {id:'user', email:'own@example.test', display_name:null, name:'Forged core name'}
  for (const path of ['/api/caches', '/api/caches/x/items', '/api/caches/x/requests']) {
    expect(() => requireProfile(path,'POST',profile)).toThrowError('profile_incomplete')
  }
  for (const [path, method] of [['/api/me','PATCH'],['/api/auth/sign-out','POST'],['/api/push/subscribe','POST'],['/api/me','GET']]) {
    expect(() => requireProfile(path, method, profile)).not.toThrow()
  }
  expect(() => requireProfile('/api/caches','POST',{...profile,display_name:'Neighbor'})).not.toThrow()
})

it('rejects missing, null, and foreign Origins on app and auth mutations', async () => {
  for (const origin of [null,'null','https://foreign.test',base+'.foreign.test']) {
    for (const path of ['/api/me','/api/auth/sign-out','/api/auth/email-otp/send-verification-otp']) {
      const response = await worker.fetch(appRequest(path,{method: path === '/api/me' ? 'PATCH' : 'POST',origin,body:{}}),env)
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({error:'invalid_origin'})
    }
  }
  const caller = await login()
  for (const origin of [null, 'null', 'https://foreign.test']) {
    const authResponse = await createAuth(env).handler(appRequest('/api/auth/sign-out',{
      method:'POST', cookie: caller.cookie, origin, body:{},
    }))
    expect(authResponse.status).toBe(403)
  }
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(1)
})

it('denies all unused auth endpoints and OTP types', async () => {
  for (const path of ['/sign-in/email','/sign-up/email','/update-user','/change-email','/admin/list-users','/email-otp/check-verification-otp','/email-otp/get-verification-otp','/email-otp/reset-password','/list-sessions']) {
    const response = await worker.fetch(authRequest(path, {email:'unused@example.test'}),env)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({error:'not_found'})
  }
  expect((await worker.fetch(authRequest('/email-otp/send-verification-otp',{email:'unused@example.test',type:'forget-password'}),env)).status).toBe(400)
  const options = authOptions(env)
  expect(options.session.cookieCache.enabled).toBe(false)
  expect(options.trustedOrigins).toEqual([base])
})

it('uses production cookie flags and rejects tampered, expired and revoked sessions', async () => {
  const caller = await login()
  expect(caller.setCookie).toContain('HttpOnly')
  expect(caller.setCookie).toContain('Secure')
  expect(caller.setCookie).toMatch(/SameSite=Lax/i)
  expect(caller.setCookie).not.toMatch(/Domain=/i)
  expect((await worker.fetch(appRequest('/api/me',{cookie:caller.cookie+'tampered'}),env)).status).toBe(401)
  const sessionResponse = await worker.fetch(appRequest('/api/auth/get-session',{cookie:caller.cookie}),env)
  const session = await sessionResponse.json() as {user:{email:string}}
  expect(session.user.email).toBe('caller@example.test')
  await env.DB.prepare('UPDATE session SET expiresAt = ? WHERE token = ?').bind(new Date(Date.now()-1_000).toISOString(),caller.token).run()
  expect((await worker.fetch(appRequest('/api/me',{cookie:caller.cookie}),env)).status).toBe(401)
  await env.DB.prepare('UPDATE session SET expiresAt = ? WHERE token = ?').bind(new Date(Date.now()+60_000).toISOString(),caller.token).run()
  await env.DB.prepare('DELETE FROM session WHERE token = ?').bind(caller.token).run()
  expect((await worker.fetch(appRequest('/api/me',{cookie:caller.cookie}),env)).status).toBe(401)
})

it('sign-out revokes D1 session immediately', async () => {
  const caller = await login()
  const response = await worker.fetch(appRequest('/api/auth/sign-out',{method:'POST',cookie:caller.cookie,body:{}}),env)
  expect(response.status).toBe(200)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(0)
  expect((await worker.fetch(appRequest('/api/me',{cookie:caller.cookie}),env)).status).toBe(401)
})

it('bounds actual streamed JSON bytes and rejects malformed bodies', async () => {
  const caller = await login()
  const chunks = new ReadableStream<Uint8Array>({start(controller) {
    controller.enqueue(new TextEncoder().encode('{"display_name":"'))
    controller.enqueue(new Uint8Array(16_385).fill(97))
    controller.close()
  }})
  const oversized = new Request(base+'/api/me',{method:'PATCH',headers:{Origin:base,Cookie:caller.cookie,'Content-Type':'application/json'},body:chunks})
  expect((await worker.fetch(oversized,env)).status).toBe(413)
  const malformed = new Request(base+'/api/me',{method:'PATCH',headers:{Origin:base,Cookie:caller.cookie,'Content-Type':'application/json'},body:'{'})
  expect((await worker.fetch(malformed,env)).status).toBe(400)
  expect(HttpError).toBeDefined()
})

it('surfaces Resend HTTP failure without a Queue or background dependency', async () => {
  vi.spyOn(globalThis,'fetch').mockImplementation(async (input,init) => turnstileMock(input,init) ?? new Response('provider failed',{status:503}))
  const response = await worker.fetch(authRequest('/email-otp/send-verification-otp',{email:'failure@example.test',type:'sign-in'}),env)
  expect(response.status).toBe(502)
  expect(await response.json()).toEqual({error:'email_unavailable'})
})

it('keeps concurrent delivery results isolated per request', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const verified = turnstileMock(_input,init)
    if (verified) return verified
    const mail = JSON.parse(init!.body as string) as { to: string[] }
    if (mail.to[0] === 'failure@example.test') return new Response('private provider detail', { status: 500 })
    return Response.json({ id: 'sent' })
  })
  const [failed, sent] = await Promise.all(['failure', 'success'].map(name => worker.fetch(
    authRequest('/email-otp/send-verification-otp', { email: `${name}@example.test`, type: 'sign-in' }), env,
  )))
  expect(failed.status).toBe(502)
  expect(await failed.json()).toEqual({ error: 'email_unavailable' })
  expect(sent.status).toBe(200)
  expect(await sent.json()).toEqual({ success: true })
})

it('passes rate-limited send responses through without claiming delivery failed', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input,init) => turnstileMock(input,init) ?? Response.json({ id: 'sent' }))
  const statuses: number[] = []
  for (let i = 0; i < 4; i++) {
    const response = await worker.fetch(authRequest('/email-otp/send-verification-otp', {
      email: `limited${i}@example.test`, type: 'sign-in',
    }, '198.51.100.20'), env)
    statuses.push(response.status)
  }
  expect(statuses).toEqual([200, 200, 200, 429])
  expect(fetchMock.mock.calls.filter(([url]) => url === 'https://api.resend.com/emails')).toHaveLength(3)
})

it('waits for bounded Resend timeout before returning a visible auth error', async () => {
  const started = Date.now()
  vi.spyOn(globalThis,'fetch').mockImplementation(async (_input, init) => {
    const verified = turnstileMock(_input,init)
    if (verified) return verified
    return new Promise((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason),{once:true}) })
  })
  const response = await worker.fetch(authRequest('/email-otp/send-verification-otp',{email:'timeout@example.test',type:'sign-in'}),env)
  expect(response.status).toBe(502)
  expect(await response.json()).toEqual({error:'email_unavailable'})
  expect(Date.now()-started).toBeGreaterThanOrEqual(9_900)
  expect(Date.now()-started).toBeLessThan(15_000)
})
