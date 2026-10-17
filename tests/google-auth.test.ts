import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { authOptions } from '../src/auth'
import { appRequest, authRequest, base, login, mailMock, turnstileMock } from './helpers'

const configured = { ...env, GOOGLE_CLIENT_ID: 'fixture-google.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-only-public-google-fixture' }
const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
function cookie(response: Response) { return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') }

function googleMock(email = 'google@example.test', verified: unknown = true, subject = 'google-subject') {
  const exchanges: URLSearchParams[] = []
  // The code flow obtains this ID token over Google's token endpoint TLS, then
  // 1.7.7 decodes its profile. No direct client-supplied ID-token flow is exposed.
  const claims = { sub: subject, email, email_verified: verified, name: 'Google Name', picture: 'https://images.example.test/private.jpg' }
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    expect(String(input)).toBe('https://oauth2.googleapis.com/token')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('manual')
    exchanges.push(new URLSearchParams(init?.body as URLSearchParams))
    return Response.json({
      access_token: 'test-only-public-access', refresh_token: 'test-only-public-refresh',
      id_token: `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}.fixture-signature`,
      expires_in: 3600, token_type: 'Bearer', scope: 'openid email profile',
    })
  })
  return { exchanges, fetch }
}
async function start(body: Record<string, unknown> = {}, bindings = configured) {
  const response = await worker.fetch(appRequest('/api/auth/sign-in/social', {
    method: 'POST', body: { provider: 'google', callbackURL: '/', errorCallbackURL: '/login', ...body },
  }), bindings)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const result = await response.json() as { url: string; redirect: boolean }
  expect(result.redirect).toBe(false)
  return { response, url: new URL(result.url), cookie: cookie(response) }
}
function callback(flow: Awaited<ReturnType<typeof start>>, options: { cookie?: string; state?: string; error?: string } = {}, bindings = configured) {
  const url = new URL('/api/auth/callback/google', bindings.APP_BASE_URL)
  url.searchParams.set('state', options.state ?? flow.url.searchParams.get('state')!)
  url.searchParams.set('code', 'fixture-authorization-code')
  if (options.error) url.searchParams.set('error', options.error)
  return worker.fetch(new Request(url, { headers: { Cookie: options.cookie ?? flow.cookie } }), bindings)
}

it('advertises Google only when both credentials exist, without exposing credentials', async () => {
  for (const bindings of [env, { ...configured, GOOGLE_CLIENT_ID: '' }, { ...configured, GOOGLE_CLIENT_SECRET: '' }, configured]) {
    const config = await worker.fetch(appRequest('/api/config'), bindings)
    const publicConfig = await config.json()
    expect(publicConfig).toMatchObject({ google_sign_in: bindings === configured })
    expect(JSON.stringify(publicConfig)).not.toMatch(/GOOGLE_CLIENT_SECRET|test-only-public-google-fixture|fixture-google/)
    if (bindings !== configured) {
      expect(authOptions(bindings).socialProviders).toEqual({})
      const denied = await worker.fetch(appRequest('/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google' } }), bindings)
      expect(denied.status).toBe(404)
    }
  }
})

it('reads the live D1 switch for effective config and rejects Google before Better Auth while off or missing', async () => {
  const fetch = googleMock().fetch
  for (const enabled of [false, true, false]) {
    await env.DB.prepare("UPDATE feature_flags SET enabled=? WHERE key='google_sign_in'").bind(enabled ? 1 : 0).run()
    for (const bindings of [configured, { ...configured, GOOGLE_CLIENT_SECRET: '' }]) {
      const response = await worker.fetch(appRequest('/api/config'), bindings)
      expect(await response.json()).toMatchObject({ google_sign_in: enabled && !!bindings.GOOGLE_CLIENT_SECRET })
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
    if (!enabled) for (const request of [
      appRequest('/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google' } }),
      appRequest('/api/auth/callback/google?state=untrusted&code=untrusted'),
    ]) {
      const response = await worker.fetch(request, configured)
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'not_found' })
    }
  }
  await env.DB.prepare("DELETE FROM feature_flags WHERE key='google_sign_in'").run()
  expect(await (await worker.fetch(appRequest('/api/config'), configured)).json()).toMatchObject({ google_sign_in: false })
  expect((await worker.fetch(appRequest('/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google' } }), configured)).status).toBe(404)
  expect(fetch).not.toHaveBeenCalled()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM verification').first('n')).toBe(0)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(0)
})

it('rechecks the switch at callback after an allowed Google start and reaches Better Auth only when enabled', async () => {
  const mock = googleMock(), flow = await start()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM verification').first('n')).toBe(1)
  await env.DB.prepare("UPDATE feature_flags SET enabled=0 WHERE key='google_sign_in'").run()
  const denied = await callback(flow)
  expect(denied.status).toBe(404)
  expect(await denied.json()).toEqual({ error: 'not_found' })
  expect(denied.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(mock.fetch).not.toHaveBeenCalled()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user').first('n')).toBe(0)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(0)
  await env.DB.prepare("UPDATE feature_flags SET enabled=1 WHERE key='google_sign_in'").run()
  expect((await callback(flow)).headers.get('Location')).toBe(base + '/')
  expect(mock.exchanges).toHaveLength(1)
  for (const enabled of [0, 1]) {
    await env.DB.prepare("UPDATE feature_flags SET enabled=? WHERE key='google_sign_in'").bind(enabled).run()
    expect((await worker.fetch(appRequest('/api/auth/link-social', { method: 'POST', body: { provider: 'google' } }), configured)).status).toBe(404)
  }
})

it('keeps email-code and explicit magic-link sign-in available while Google is switched off', async () => {
  await env.DB.prepare("UPDATE feature_flags SET enabled=0 WHERE key='google_sign_in'").run()
  const codes = mailMock()
  expect((await worker.fetch(authRequest('/email-otp/send-verification-otp', { email: 'code-fallback@example.test', type: 'sign-in' }), configured)).status).toBe(200)
  expect((await worker.fetch(authRequest('/sign-in/email-otp', { email: 'code-fallback@example.test', otp: codes[0] }), configured)).status).toBe(200)
  let landing = ''
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const verdict = turnstileMock(input, init)
    if (verdict) return verdict
    expect(String(input)).toBe('https://api.resend.com/emails')
    landing = JSON.parse(init!.body as string).text.match(/https:\/\/[^\s]+/)[0]
    return Response.json({ id: 'fixture-mail' })
  })
  expect((await worker.fetch(authRequest('/sign-in/magic-link', { email: 'link-fallback@example.test' }), configured)).status).toBe(200)
  const token = new URLSearchParams(new URL(landing).hash.slice(1)).get('token')
  expect((await worker.fetch(authRequest('/magic-link/verify', { token }), configured)).status).toBe(200)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(2)
})

it('uses exact origins, trusted Google plus strict verified-email linking, D1 state and private Lax cookies', async () => {
  const options = authOptions(configured)
  expect(options.trustedOrigins).toEqual([base])
  expect(options.account).toMatchObject({ accountLinking: { enabled: true, trustedProviders: ['google'], requireLocalEmailVerified: true, allowDifferentEmails: false }, storeStateStrategy: 'database', skipStateCookieCheck: false, storeAccountCookie: false })
  const flow = await start()
  expect(flow.url.origin).toBe('https://accounts.google.com')
  expect(flow.url.pathname).toBe('/o/oauth2/v2/auth')
  expect(flow.url.searchParams.get('redirect_uri')).toBe(base + '/api/auth/callback/google')
  expect(flow.url.searchParams.get('client_id')).toBe(configured.GOOGLE_CLIENT_ID)
  expect(flow.url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32}$/)
  expect(flow.url.searchParams.get('code_challenge_method')).toBe('S256')
  expect(flow.url.searchParams.get('scope')!.split(' ').sort()).toEqual(['email', 'openid', 'profile'])
  const setCookie = flow.response.headers.get('Set-Cookie')!
  expect(setCookie).toContain('HttpOnly'); expect(setCookie).toContain('Secure'); expect(setCookie).toMatch(/SameSite=Lax/i)
  expect(setCookie).not.toMatch(/Domain=/i)
  const state = await env.DB.prepare('SELECT value FROM verification WHERE identifier=?').bind(`auth-state:${flow.url.searchParams.get('state')}`).first<string>('value')
  expect(JSON.parse(state!)).toMatchObject({ callbackURL: base + '/', errorURL: base + '/login' })
  expect(JSON.parse(state!).codeVerifier).toHaveLength(128)
})

it('creates a verified user without Google name/photo onboarding bypass or persisted OAuth tokens', async () => {
  const mock = googleMock(), flow = await start()
  const response = await callback(flow)
  expect(response.status).toBe(302)
  expect(response.headers.get('Location')).toBe(base + '/')
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(response.headers.get('Set-Cookie')).toMatch(/HttpOnly.*Secure.*SameSite=Lax/i)
  const me = await worker.fetch(appRequest('/api/me', { cookie: cookie(response) }), configured)
  expect(await me.json()).toMatchObject({ email: 'google@example.test', display_name: null, profile_photo_version: null })
  expect(await env.DB.prepare('SELECT name,image,emailVerified,display_name FROM user').first()).toEqual({ name: '', image: null, emailVerified: 1, display_name: null })
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user_photos').first('n')).toBe(0)
  const account = await env.DB.prepare('SELECT providerId,accountId,accessToken,refreshToken,idToken,accessTokenExpiresAt,refreshTokenExpiresAt FROM account').first()
  expect(account).toEqual({ providerId: 'google', accountId: 'google-subject', accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null })
  expect((await worker.fetch(appRequest('/api/caches', { method: 'POST', cookie: cookie(response), body: { name: 'No bypass' } }), configured)).status).toBe(409)
  const verifier = mock.exchanges[0].get('code_verifier')!
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  const challenge = btoa(String.fromCharCode(...digest)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  expect(challenge).toBe(flow.url.searchParams.get('code_challenge'))
  expect(mock.exchanges[0].get('redirect_uri')).toBe(base + '/api/auth/callback/google')
  expect(mock.exchanges[0].get('code')).toBe('fixture-authorization-code')
  expect((await callback(flow)).headers.get('Location')).toContain('error=state_mismatch')
  expect(mock.exchanges).toHaveLength(1)
})

it('links an existing email-verified account, retains its chosen profile and scrubs repeat sign-in token writes', async () => {
  const existing = await login('google@example.test')
  await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: existing.cookie, body: { display_name: 'Chosen name' } }), env)
  googleMock()
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await callback(await start())
    expect(response.status).toBe(302)
    const me = await worker.fetch(appRequest('/api/me', { cookie: cookie(response) }), configured)
    expect(await me.json()).toMatchObject({ id: existing.id, display_name: 'Chosen name' })
    expect(await env.DB.prepare('SELECT accessToken,refreshToken,idToken FROM account WHERE providerId=\'google\'').first()).toEqual({ accessToken: null, refreshToken: null, idToken: null })
  }
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user').first('n')).toBe(1)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM account WHERE providerId=\'google\' AND userId=?').bind(existing.id).first('n')).toBe(1)
})

it.each([false, undefined, 'true'])('rejects an unverified or malformed Google email claim (%s) before any user/account/session write', async verified => {
  googleMock('unverified@example.test', verified === undefined ? null : verified)
  const response = await callback(await start())
  expect(new URL(response.headers.get('Location')!).searchParams.get('error')).toBe('email_not_verified')
  for (const table of ['user', 'account', 'session']) expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n')).toBe(0)
})

it('rejects unverified Google claims when linking and on returning linked-account sign-in', async () => {
  const existing = await login('google@example.test')
  googleMock('google@example.test', false)
  expect((await callback(await start())).headers.get('Location')).toContain('error=email_not_verified')
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM account').first('n')).toBe(0)
  googleMock()
  expect((await callback(await start())).headers.get('Location')).toBe(base + '/')
  googleMock('google@example.test', false)
  expect((await callback(await start())).headers.get('Location')).toContain('error=email_not_verified')
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session WHERE userId=?').bind(existing.id).first('n')).toBe(2)
})

it('does not implicitly link an unverified local account even to a verified Google email', async () => {
  const now = new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,?,?)').bind(crypto.randomUUID(), '', 'google@example.test', now, now).run()
  googleMock()
  expect((await callback(await start())).headers.get('Location')).toContain('error=account_not_linked')
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user').first('n')).toBe(1)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM account').first('n')).toBe(0)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(0)
})

it('requires the matching signed state cookie and rejects missing, forged, expired and cross-flow states before exchange', async () => {
  const mock = googleMock(), flow = await start(), other = await start()
  for (const options of [{ cookie: '' }, { cookie: flow.cookie.replace(/=./, '=x') }, { cookie: other.cookie }, { state: 'not-the-state' }]) {
    const rejected = await callback(flow, options)
    expect(rejected.headers.get('Location')).toContain('error=state_mismatch')
    expect(rejected.headers.get('Cache-Control')).toBe('no-store')
  }
  await env.DB.prepare("UPDATE verification SET expiresAt=?,value=json_set(value,'$.expiresAt',?)").bind(new Date(Date.now() - 1_000).toISOString(), Date.now() - 1_000).run()
  expect((await callback(flow)).headers.get('Location')).toContain('error=state_mismatch')
  expect(mock.fetch).not.toHaveBeenCalled()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(0)
})

it('preserves invite success/error callbacks without joining automatically and returns provider cancellation safely', async () => {
  const destination = `/join/11111111-1111-4111-8111-111111111111.${'A'.repeat(43)}`
  googleMock()
  const response = await callback(await start({ callbackURL: destination, errorCallbackURL: destination }))
  expect(response.headers.get('Location')).toBe(base + destination)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM memberships').first('n')).toBe(0)
  const cancel = await callback(await start({ callbackURL: destination, errorCallbackURL: destination }), { error: 'access_denied' })
  expect(cancel.headers.get('Location')).toBe(base + destination + '?error=access_denied')
})

it('restricts the endpoint surface, rejects callbacks and requires exact Origin without Turnstile for Google', async () => {
  const mock = googleMock()
  for (const origin of [null, 'null', 'https://foreign.test']) {
    const denied = await worker.fetch(appRequest('/api/auth/sign-in/social', { method: 'POST', origin, body: { provider: 'google' } }), configured)
    expect(denied.status).toBe(403)
  }
  for (const field of ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL']) for (const value of ['https://foreign.test/', '//foreign.test/', 'https://user:pass@communalcache.com/', 'javascript:alert(1)', null]) {
    const denied = await worker.fetch(appRequest('/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google', [field]: value } }), configured)
    expect(denied.status).toBe(400)
    expect(await denied.json()).toEqual({ error: 'invalid_callback' })
  }
  for (const body of [{ provider: 'github' }, { provider: 'google', idToken: { token: 'untrusted' } }]) {
    expect((await worker.fetch(appRequest('/api/auth/sign-in/social', { method: 'POST', body }), configured)).status).toBe(400)
  }
  expect((await worker.fetch(appRequest('/api/auth/sign-in/social'), configured)).status).toBe(405)
  expect((await worker.fetch(appRequest('/api/auth/callback/google', { method: 'POST', body: {} }), configured)).status).toBe(405)
  expect((await worker.fetch(appRequest('/api/auth/callback/github'), configured)).status).toBe(404)
  expect((await worker.fetch(appRequest('/api/auth/link-social', { method: 'POST', body: {} }), configured)).status).toBe(404)
  await start()
  expect(mock.fetch).not.toHaveBeenCalled()
})

it('maps unexpected auth database failures to private no-store JSON 503 responses', async () => {
  await env.DB.exec("CREATE TRIGGER fail_oauth_state BEFORE INSERT ON verification BEGIN SELECT RAISE(ABORT, 'injected state failure'); END")
  try {
    const response = await worker.fetch(appRequest('/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google' } }), configured)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'auth_unavailable' })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  } finally { await env.DB.exec('DROP TRIGGER fail_oauth_state') }
})

it('rejects a missing state and returns a friendly generic error after provider transport failure without a session', async () => {
  const mock = googleMock()
  const noState = await worker.fetch(new Request(base + '/api/auth/callback/google?code=untrusted'), configured)
  expect(noState.headers.get('Location')).toBe(base + '/login?error=state_not_found')
  expect(mock.fetch).not.toHaveBeenCalled()
  const flow = await start()
  mock.fetch.mockRejectedValueOnce(new Error('private-provider-detail'))
  const failed = await callback(flow)
  expect(failed.headers.get('Location')).toBe(base + '/login?error=invalid_code')
  expect(await failed.text()).not.toContain('private-provider-detail')
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(0)
})

it('uses non-Secure HttpOnly Lax state cookies only on the registered localhost development origin', async () => {
  const local = { ...configured, APP_BASE_URL: 'http://localhost:8787', BETTER_AUTH_URL: 'http://localhost:8787' }
  const response = await worker.fetch(new Request(local.APP_BASE_URL + '/api/auth/sign-in/social', {
    method: 'POST', headers: { Origin: local.APP_BASE_URL, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'google' }),
  }), local)
  expect(response.status).toBe(200)
  expect(response.headers.get('Set-Cookie')).toContain('HttpOnly')
  expect(response.headers.get('Set-Cookie')).toMatch(/SameSite=Lax/i)
  expect(response.headers.get('Set-Cookie')).not.toContain('Secure')
  expect((await response.json() as { url: string }).url).toContain(encodeURIComponent(local.APP_BASE_URL + '/api/auth/callback/google'))
})
