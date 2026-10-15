import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { authOptions } from '../src/auth'
import { cacheDetail, createCache } from '../src/db'
import { authRequest, appRequest, base, login, turnstileMock } from './helpers'

type Mail = { text: string; html?: string; subject: string; to: string[] }
function mailMock() {
  const mails: Mail[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const verified = turnstileMock(input,init)
    if (verified) return verified
    expect(input).toBe('https://api.resend.com/emails')
    expect(init?.redirect).toBe('manual')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    mails.push(JSON.parse(init!.body as string))
    return Response.json({ id: 'mock-mail' })
  })
  return mails
}
function link(mail: Mail) { return new URL(mail.text.match(/https:\/\/\S+/)![0]) }
function token(url: URL) { return new URLSearchParams(url.hash.slice(1)).get('token')! }
async function sendLink(email = 'neighbor@example.test', callbacks: Record<string, unknown> = {}, ip?: string) {
  return worker.fetch(authRequest('/sign-in/magic-link', { email, ...callbacks }, ip), env)
}
function verify(url: URL, overrides: Record<string, unknown> = {}, ip?: string) {
  return worker.fetch(authRequest('/magic-link/verify', { ...Object.fromEntries(new URLSearchParams(url.hash.slice(1))), ...overrides }, ip), env)
}

it('sends only a fixed-origin fragment landing link, hashes 300s tokens and keeps migration 0003 compatible', async () => {
  const mails = mailMock()
  expect((await sendLink()).status).toBe(200)
  const url = link(mails[0])
  expect(url.origin).toBe(base)
  expect(url.pathname).toBe('/auth/link')
  expect(url.search).toBe('')
  expect(mails[0].subject).toBe('Your Communal Cache sign-in link')
  expect(mails[0].text).toContain('5 minutes')
  expect(mails[0].text).toContain('Use the newest link if you requested another')
  expect(mails[0].text).not.toMatch(/\b\d{6}\b/)
  expect(mails[0].text).not.toContain('/api/auth/magic-link/verify')
  const row = await env.DB.prepare('SELECT identifier,value,createdAt,expiresAt FROM verification').first<{ identifier: string; value: string; createdAt: string; expiresAt: string }>()
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token(url)))
  const encoded = btoa(String.fromCharCode(...new Uint8Array(hash))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  expect(row!.identifier).toBe(`magic-link:${encoded}`)
  expect(JSON.stringify(row)).not.toContain(token(url))
  expect(JSON.parse(row!.value)).toEqual({ type: 'magic-link', email: 'neighbor@example.test' })
  expect(new Date(row!.expiresAt).getTime() - new Date(row!.createdAt).getTime()).toBeGreaterThan(299_000)
  expect(new Date(row!.expiresAt).getTime() - new Date(row!.createdAt).getTime()).toBeLessThanOrEqual(300_000)
  expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name='verification_sign_in_otp_identifier_unique'").first('name')).toBe('verification_sign_in_otp_identifier_unique')
  const plugin = authOptions(env).plugins.find(row => row.id === 'magic-link')!
  expect(plugin.options).toMatchObject({ expiresIn: 300, storeToken: 'hashed', rateLimit: { window: 60, max: 5 } })
  expect(plugin.options).not.toHaveProperty('allowedAttempts')
})

it('sends a responsive inline/table HTML sign-in button with an escaped landing href and unchanged text fallback', async () => {
  const mails = mailMock()
  expect((await sendLink('neighbor@example.test', { callbackURL: '/requests?source=email&view=mine' })).status).toBe(200)
  const mail = mails[0], url = link(mail)
  expect(url.href).toContain('&')
  const escaped = url.href.replaceAll('&', '&amp;')
  expect(mail.html).toContain(`href="${escaped}"`)
  expect(mail.html).not.toContain(`href="${url.href}"`)
  expect(mail.html).toMatch(/<a [^>]+>Sign in<\/a>/)
  expect(mail.html).toContain('<table role="presentation"')
  expect(mail.html).toContain('Sign in to Communal Cache')
  expect(mail.html).toContain('Tap the button, then press Continue.')
  expect(mail.html).toContain('This link works once and expires in 5 minutes.')
  expect(mail.html).toContain('use the newest email')
  expect(mail.html).toContain("Didn't ask for this? You can ignore it.")
  expect(mail.html).not.toMatch(/<img\b|<svg\b|<script\b|<style\b|<link\b/)
  expect(mail.html).not.toContain('/api/auth/magic-link/verify')
  expect(mail.html).not.toContain('neighbor@example.test')
  expect(mail.text).toContain(url.href)
  expect(mail.text).toContain('Open it, then press Continue')
  expect(mail.text).not.toMatch(/\b\d{6}\b/)
})

it('scanner GET/HEAD and public GET verification consume nothing; explicit POST creates a private session without prior browser state', async () => {
  const mails = mailMock()
  await sendLink()
  const url = link(mails[0])
  const assets = { fetch: vi.fn(async () => new Response('<!doctype html><div id="root"></div>')) } as unknown as Fetcher
  for (const method of ['GET', 'HEAD']) {
    const landing = await worker.fetch(new Request(url.origin + url.pathname, { method }), { ...env, ASSETS: assets })
    expect(landing.status).toBe(200)
    expect(landing.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(landing.headers.get('Cache-Control')).toBe('no-store')
  }
  const direct = await worker.fetch(new Request(`${base}/api/auth/magic-link/verify?token=${token(url)}`), env)
  expect(direct.status).toBe(405)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM verification').first('n')).toBe(1)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(0)
  const response = await verify(url, {}, '203.0.113.88')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ success: true, callback_url: base + '/' })
  expect(response.headers.get('Location')).toBeNull()
  const cookie = response.headers.get('Set-Cookie')!
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('Secure')
  expect(cookie).toMatch(/SameSite=Lax/i)
  const me = await worker.fetch(appRequest('/api/me', { cookie: cookie.split(';')[0] }), env)
  expect(await me.json()).toMatchObject({ email: 'neighbor@example.test', display_name: null })
  expect((await verify(url)).status).toBe(400)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(1)
})

it('parallel redemptions mint exactly one session across independent Worker auth instances', async () => {
  const mails = mailMock()
  await sendLink()
  const url = link(mails[0])
  const results = await Promise.all(Array.from({ length: 12 }, () => verify(url)))
  expect(results.filter(row => row.status === 200)).toHaveLength(1)
  expect(results.filter(row => row.status === 400)).toHaveLength(11)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(1)
})

it('does not revive a consumed token after session creation fails', async () => {
  const mails = mailMock()
  await sendLink()
  const url = link(mails[0])
  await env.DB.exec("CREATE TRIGGER fail_session BEFORE INSERT ON session BEGIN SELECT RAISE(ABORT, 'injected session failure'); END")
  expect((await verify(url)).status).toBe(503)
  await env.DB.exec('DROP TRIGGER fail_session')
  expect((await verify(url)).status).toBe(400)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(0)
})

it('expired, missing and malformed tokens return JSON errors without sessions', async () => {
  const mails = mailMock()
  await sendLink()
  const url = link(mails[0])
  await env.DB.prepare('UPDATE verification SET expiresAt=?').bind(new Date(Date.now() - 1_000).toISOString()).run()
  for (const bad of [{}, { token: '' }, { token: 3 }, { token: 'bad' }, { token: 'Z'.repeat(32) }]) {
    const response = await worker.fetch(authRequest('/magic-link/verify', bad), env)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_magic_link' })
  }
  const expired = await verify(url)
  expect(expired.status).toBe(400)
  expect(await expired.json()).toEqual({ error: 'invalid_magic_link' })
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(0)
})

it('retains exact app Origin protection on both send and verify and rejects GET sends', async () => {
  const mails = mailMock()
  await sendLink()
  const url = link(mails[0])
  for (const origin of [null, 'null', 'https://foreign.test']) for (const path of ['/api/auth/sign-in/magic-link', '/api/auth/magic-link/verify']) {
    const response = await worker.fetch(appRequest(path, { method: 'POST', origin, body: { email: 'neighbor@example.test', token: token(url) } }), env)
    expect(response.status).toBe(403)
  }
  expect((await worker.fetch(authRequest('/sign-in/magic-link'), env)).status).toBe(405)
  expect(mails).toHaveLength(1)
  expect((await verify(url)).status).toBe(200)
})

it('rejects foreign/protocol-relative/credential callbacks before send or consume for every callback field', async () => {
  const mails = mailMock()
  await sendLink()
  const url = link(mails[0])
  for (const field of ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL']) {
    for (const value of ['https://foreign.test', '//foreign.test', '//communalcache.com/requests', '\\foreign.test', 'https://user:pass@communalcache.com/', 'javascript:alert(1)', 'https://communalcache.com:444/', '/' + 'é'.repeat(400), null]) {
      const rejected = await sendLink('neighbor@example.test', { [field]: value })
      expect(rejected.status).toBe(400)
      expect(await rejected.json()).toEqual({ error: 'invalid_callback' })
      const verification = await verify(url, { [field]: value })
      expect(verification.status).toBe(400)
      expect(await verification.json()).toEqual({ error: 'invalid_callback' })
    }
  }
  expect(mails).toHaveLength(1)
  expect((await verify(url)).status).toBe(200)
})

it.each([false,true])('carries a valid invite across independent-browser verification and keeps the explicit %s approval join step', async requiresApproval => {
  const mails = mailMock(), owner=crypto.randomUUID(), now=new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?,?,?,1,?,?,?)').bind(owner,'Owner',`${owner}@example.test`,now,now,'Owner').run()
  const cache=await createCache(env.DB,owner,'Maple St',requiresApproval), destination=`/join/${cache.invite_token}`
  expect((await sendLink('new-browser@example.test',{callbackURL:destination})).status).toBe(200)
  const url=link(mails[0]), fragment=new URLSearchParams(url.hash.slice(1))
  expect(url.pathname).toBe('/auth/link');expect(url.search).toBe('')
  for(const field of ['callbackURL','newUserCallbackURL','errorCallbackURL']) expect(fragment.get(field)).toBe(destination)
  const response=await verify(url), cookie=response.headers.get('Set-Cookie')!.split(';')[0]
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({success:true,callback_url:base+destination})
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM memberships').first('n')).toBe(1)
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie,body:{display_name:'Neighbor'}}),env)
  const joined=await worker.fetch(appRequest(`/api/caches/${cache.id}/join`,{method:'POST',cookie,body:{secret:cache.invite_token.split('.')[1]}}),env)
  expect(await joined.json()).toMatchObject({cache_id:cache.id,name:'Maple St',status:requiresApproval?'pending':'active'})
})

it('rejects malformed or non-relative invite callbacks before send or consume while retaining ordinary same-origin callbacks', async ()=>{
  const mails=mailMock(), invite=`11111111-1111-4111-8111-111111111111.${'A'.repeat(43)}`
  await sendLink()
  const url=link(mails[0])
  for(const field of ['callbackURL','newUserCallbackURL','errorCallbackURL']) for(const value of [base+`/join/${invite}`,`https://foreign.test/join/${invite}`,`join/${invite}`,base+`/JOIN/${invite}`,`/j%6fin/${invite}`,'/join/bad',`/join/${invite}/`,`/join/${invite}?next=evil`,`/join/${invite}#x`]) {
    const send=await sendLink('neighbor@example.test',{[field]:value}), consume=await verify(url,{[field]:value})
    expect(send.status).toBe(400);expect(consume.status).toBe(400)
    expect(await send.json()).toEqual({error:'invalid_callback'})
  }
  expect(mails).toHaveLength(1)
  expect((await verify(url)).status).toBe(200)
})

it('normalizes relative/exact-origin callbacks and selects the plugin new-user versus existing-user destination', async () => {
  const mails = mailMock()
  await sendLink('neighbor@example.test', { callbackURL: '/requests', newUserCallbackURL: base + '/welcome', errorCallbackURL: '/login' })
  const first = await verify(link(mails[0]))
  expect(await first.json()).toEqual({ success: true, callback_url: base + '/welcome' })
  await sendLink('neighbor@example.test', { callbackURL: 'requests', newUserCallbackURL: '/welcome' })
  expect(await (await verify(link(mails[1]))).json()).toEqual({ success: true, callback_url: base + '/requests' })
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user').first('n')).toBe(1)
})

it('uses D1-backed five-per-minute send limits across concurrent independent instances', async () => {
  const mails = mailMock()
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => sendLink(`neighbor${index}@example.test`, {}, '198.51.100.44')))
  expect(results.filter(row => row.status === 200)).toHaveLength(5)
  expect(results.filter(row => row.status === 429)).toHaveLength(7)
  expect(mails).toHaveLength(5)
  expect(await env.DB.prepare('SELECT count FROM rateLimit').first('count')).toBe(5)
  expect((await sendLink('later@example.test', {}, '198.51.100.44')).status).toBe(429)
})

it('retains the plugin verification D1 rate limit through the POST adapter without consuming a blocked token', async () => {
  const mails = mailMock()
  await sendLink()
  const url = link(mails[0])
  const results = await Promise.all(Array.from({ length: 12 }, () => verify(url, { token: 'Z'.repeat(32) }, '198.51.100.55')))
  expect(results.filter(row => row.status === 400)).toHaveLength(5)
  expect(results.filter(row => row.status === 429)).toHaveLength(7)
  const blocked = await verify(url, {}, '198.51.100.55')
  expect(blocked.status).toBe(429)
  expect(blocked.headers.get('X-Retry-After')).toBeTruthy()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM verification').first('n')).toBe(1)
  expect((await verify(url)).status).toBe(200)
})

it('maps bounded Resend HTTP/network failures to 502 and isolates concurrent send outcomes', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const verified = turnstileMock(_input,init)
    if (verified) return verified
    const mail = JSON.parse(init!.body as string) as Mail
    if (mail.to[0] === 'network@example.test') throw new Error('private transport detail')
    return mail.to[0] === 'failed@example.test' ? new Response('private provider detail', { status: 503 }) : Response.json({ id: 'sent' })
  })
  const [failed, sent, network] = await Promise.all(['failed', 'sent', 'network'].map(name => sendLink(`${name}@example.test`)))
  expect(failed.status).toBe(502)
  expect(network.status).toBe(502)
  expect(await failed.json()).toEqual({ error: 'email_unavailable' })
  expect(await network.json()).toEqual({ error: 'email_unavailable' })
  expect(sent.status).toBe(200)
})

it('waits for a 10-second magic-link delivery timeout and reports email_unavailable', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const verified = turnstileMock(_input,init)
    if (verified) return verified
    return new Promise((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }) })
  })
  const started = Date.now()
  const response = await sendLink()
  expect(response.status).toBe(502)
  expect(await response.json()).toEqual({ error: 'email_unavailable' })
  expect(Date.now() - started).toBeGreaterThanOrEqual(9_900)
  expect(Date.now() - started).toBeLessThan(15_000)
})

it('keeps OTP fallback end to end and its unique index independent of outstanding links', async () => {
  const mails = mailMock()
  await sendLink('caller@example.test')
  const url = link(mails[0])
  const caller = await login('caller@example.test')
  expect((await worker.fetch(appRequest('/api/me', { cookie: caller.cookie }), env)).status).toBe(200)
  expect((await verify(url)).status).toBe(200)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user').first('n')).toBe(1)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(2)
})

it('preserves caller-scoped profile onboarding and joins after link verification', async () => {
  const mails = mailMock()
  await sendLink()
  const response = await verify(link(mails[0]))
  const cookie = response.headers.get('Set-Cookie')!.split(';')[0]
  expect((await worker.fetch(appRequest('/api/caches', { method: 'POST', cookie, body: { name: 'Tools' } }), env)).status).toBe(409)
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie, body: { display_name: 'Neighbor' } }), env)
  const me = await (await worker.fetch(appRequest('/api/me', { cookie }), env)).json() as { id: string }
  const owner = crypto.randomUUID(), now = new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)').bind(owner,'Owner',`${owner}@example.test`,now,now).run()
  const cache = await createCache(env.DB, owner, 'Tools', false)
  const join = await worker.fetch(appRequest(`/api/caches/${cache.id}/join`, { method: 'POST', cookie, body: { secret: cache.invite_token.split('.')[1] } }), env)
  expect(await join.json()).toMatchObject({ cache_id: cache.id, status: 'active' })
  expect((await cacheDetail(env.DB, cache.id, me.id)).members.some(row => row.user_id === me.id)).toBe(true)
})
