import { expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { appRequest, base, login } from './helpers'

type RouteOutcome = readonly [number, string?]
const cacheId = 'aabbccdd-1122-4334-8556-aabbccddeeff'
const itemId = 'bbccddee-2233-4445-8667-bbccddeeffaa'
const userId = 'ccddeeff-3344-4556-8778-ccddeeffaabb'
const requestId = 'ddeeffaa-4455-4667-8889-ddeeffaabbcc'
const cachePath = `/api/caches/${cacheId}`, itemPath = `${cachePath}/items/${itemId}`
const privateItemPath = `/api/me/items/${itemId}`, requestPath = `/api/me/requests/${requestId}`
const routingCases: { path: string; outcomes: Record<string, RouteOutcome>; public?: boolean; photo?: boolean; unknown?: boolean; admin?: boolean }[] = [
  { path: '/api/healthz', public: true, outcomes: { GET: [200], HEAD: [200] } },
  { path: '/api/config', public: true, outcomes: { GET: [200], HEAD: [200] } },
  { path: '/api/me', outcomes: { GET: [200], PATCH: [400, 'invalid_display_name'] } },
  { path: '/api/me/summary', outcomes: { GET: [200] } },
  { path: '/api/caches', outcomes: { GET: [200], POST: [409, 'profile_incomplete'] } },
  { path: '/api/requests', outcomes: { GET: [200] } },
  { path: '/api/push/subscribe', outcomes: { POST: [400, 'invalid_push_endpoint'], DELETE: [400, 'invalid_push_endpoint'] } },
  { path: '/api/me/contact', outcomes: { GET: [200], PUT: [409, 'profile_incomplete'], DELETE: [409, 'profile_incomplete'] } },
  { path: '/api/me/contact/preview', outcomes: { POST: [409, 'profile_incomplete'] } },
  { path: '/api/me/photo', photo: true, outcomes: { GET: [404, 'not_found'], POST: [409, 'profile_incomplete'], DELETE: [409, 'profile_incomplete'] } },
  { path: `/api/users/${userId}/photo`, photo: true, outcomes: { GET: [404, 'not_found'] } },
  { path: '/api/me/items', outcomes: { GET: [200], POST: [409, 'profile_incomplete'] } },
  { path: privateItemPath, outcomes: { GET: [404, 'not_found'], PATCH: [409, 'profile_incomplete'], DELETE: [409, 'profile_incomplete'] } },
  { path: `${privateItemPath}/photo`, photo: true, outcomes: { GET: [404, 'not_found'], POST: [409, 'profile_incomplete'] } },
  { path: `${privateItemPath}/attachments/${cacheId}`, outcomes: { PUT: [409, 'profile_incomplete'], DELETE: [409, 'profile_incomplete'] } },
  { path: cachePath, outcomes: { GET: [404, 'not_found'], PATCH: [409, 'profile_incomplete'] } },
  { path: `${cachePath}/invite/preview`, outcomes: { GET: [404, 'not_found'] } },
  { path: `${cachePath}/invite/rotate`, outcomes: { POST: [409, 'profile_incomplete'] } },
  { path: `${cachePath}/join`, outcomes: { POST: [409, 'profile_incomplete'] } },
  { path: `${cachePath}/leave`, outcomes: { POST: [409, 'profile_incomplete'] } },
  { path: `${cachePath}/join-requests`, outcomes: { GET: [404, 'not_found'] } },
  { path: `${cachePath}/join-requests/${userId}/approve`, outcomes: { POST: [409, 'profile_incomplete'] } },
  { path: `${cachePath}/join-requests/${userId}/reject`, outcomes: { POST: [409, 'profile_incomplete'] } },
  { path: `${cachePath}/members/${userId}`, outcomes: { DELETE: [409, 'profile_incomplete'] } },
  { path: `${cachePath}/items`, outcomes: { GET: [404, 'not_found'], POST: [409, 'profile_incomplete'] } },
  { path: itemPath, outcomes: { GET: [404, 'not_found'], PATCH: [409, 'profile_incomplete'], DELETE: [409, 'profile_incomplete'] } },
  { path: `${itemPath}/photo`, photo: true, outcomes: { GET: [404, 'not_found'], POST: [409, 'profile_incomplete'] } },
  { path: `${itemPath}/requests`, outcomes: { GET: [404, 'not_found'], POST: [409, 'profile_incomplete'] } },
  { path: `${cachePath}/requests/${requestId}/approve`, outcomes: { POST: [409, 'profile_incomplete'] } },
  { path: `${cachePath}/requests/${requestId}/reject`, outcomes: { POST: [409, 'profile_incomplete'] } },
  { path: requestPath, outcomes: { GET: [404, 'not_found'] } },
  { path: `${requestPath}/contact`, outcomes: { GET: [404, 'not_found'] } },
  { path: `${requestPath}/approve`, outcomes: { POST: [409, 'profile_incomplete'] } },
  { path: `${requestPath}/reject`, outcomes: { POST: [409, 'profile_incomplete'] } },
  { path: '/api', unknown: true, outcomes: {} },
  { path: '/api/missing', unknown: true, outcomes: {} },
  { path: '/api/auth/missing', unknown: true, outcomes: {} },
  { path: '/api/caches/not-a-uuid', unknown: true, outcomes: {} },
  { path: `${cachePath}/items/${itemId}/attachments/${cacheId}`, unknown: true, outcomes: {} },
  { path: `${privateItemPath}/requests`, unknown: true, outcomes: {} },
  { path: `${cachePath}/join/secret`, unknown: true, outcomes: {} },
  { path: `/api/users/${userId}`, unknown: true, outcomes: {} },
  { path: '/api/ME', unknown: true, outcomes: {} },
  { path: `${cachePath}/items/`, unknown: true, outcomes: {} },
  { path: '/api/auth/email-otp/send-verification-otp', public: true, outcomes: { POST: [400, 'invalid_type'] } },
  { path: '/api/auth/sign-in/email-otp', public: true, outcomes: { POST: [400, 'invalid_otp'] } },
  { path: '/api/auth/sign-in/magic-link', public: true, outcomes: { POST: [403, 'turnstile_failed'] } },
  { path: '/api/auth/magic-link/verify', public: true, outcomes: { POST: [400, 'invalid_magic_link'] } },
  { path: '/api/auth/get-session', public: true, outcomes: { GET: [200] } },
  // Admin is hidden before method/OPTIONS dispatch without both independent grants.
  { path: '/admin', admin: true, outcomes: {} },
  { path: '/api/admin/overview', admin: true, outcomes: {} },
  { path: '/api/admin/caches', admin: true, outcomes: {} },
  { path: '/api/admin/users', admin: true, outcomes: {} },
  { path: '/api/admin/failed-outbox', admin: true, outcomes: {} },
  { path: `/api/admin/caches/${cacheId}/plan`, admin: true, outcomes: {} },
  { path: `/api/admin/users/${userId}/plan`, admin: true, outcomes: {} },
  // Sign-out comes last so the unnamed caller keeps its D1 session for every prior cell.
  { path: '/api/auth/sign-out', public: true, outcomes: { POST: [200] } },
]
const methodCases = ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']
const routeMethodMatrix = routingCases.flatMap(route => {
  const upper = route.path.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/g, id => id.toUpperCase())
  return [...new Set([route.path, upper])].flatMap(path => methodCases.map(method => ({ route, path, method })))
})

it.each(['signed-out', 'unnamed'] as const)(`preserves ${routeMethodMatrix.length} explicit route/method cells for a %s caller`, async caller => {
  const cookie = caller === 'unnamed' ? (await login()).cookie : undefined
  for (const { route, path, method } of routeMethodMatrix) {
    const allowed = route.outcomes[method]
    const expected: RouteOutcome = route.admin ? [404, 'not_found'] : method === 'OPTIONS' ? [204]
      : route.unknown ? [404, 'not_found'] : !allowed ? [405, 'method_not_allowed']
      : route.public || cookie ? allowed : route.photo && method === 'GET' ? [404, 'not_found'] : [401, 'unauthorized']
    const response = await worker.fetch(appRequest(path, {
      method, cookie, origin: method === 'OPTIONS' ? null : base,
      body: ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? {} : undefined,
    }), env)
    const label = `${caller}: ${method} ${path}`
    expect(response.status, label).toBe(expected[0])
    if (method === 'OPTIONS' && !route.admin) { expect(await response.text(), label).toBe(''); continue }
    expect(response.headers.get('Content-Type'), label).toContain('application/json')
    expect(response.headers.get('Cache-Control'), label).toBe('no-store')
    const body = await response.json()
    if (expected[1]) expect(body, label).toEqual({ error: expected[1] })
    else if (body !== null) expect(body, label).not.toHaveProperty('error')
  }
})

it('checks Origin before method, route, session and body validation, but OPTIONS before Origin', async () => {
  const paths = ['/api/missing', '/api/auth/missing', '/api/healthz', '/api/me', `${cachePath}/invite/preview`, `${privateItemPath}/attachments/${cacheId}`, `/api/users/${userId}/photo`]
  for (const path of paths) for (const origin of [null, 'null', 'https://foreign.test']) {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const response = await worker.fetch(appRequest(path, { method, origin }), env)
      expect(response.status, `${method} ${path} Origin=${origin}`).toBe(403)
      expect(await response.json()).toEqual({ error: 'invalid_origin' })
    }
    const response = await worker.fetch(appRequest(path, { method: 'OPTIONS', origin }), env)
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  }
})

it('lets an unnamed caller complete PATCH /api/me while retaining the push exemption', async () => {
  const caller = await login()
  const push = await worker.fetch(appRequest('/api/push/subscribe', { method: 'DELETE', cookie: caller.cookie, body: { endpoint: 'https://push.example.test/unused' } }), env)
  expect(push.status).toBe(204)
  const response = await worker.fetch(appRequest('/api/me', { method: 'PATCH', cookie: caller.cookie, body: { display_name: 'Neighbor' } }), env)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ id: caller.id, display_name: 'Neighbor' })
})

it('Worker routes use canonical D1 authority and enrich only public names', async () => {
  const caller = await login()
  expect((await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:caller.cookie,body:{display_name:'Owner'}}),env)).status).toBe(200)
  const response = await worker.fetch(appRequest('/api/caches',{method:'POST',cookie:caller.cookie,body:{name:'  Tools  ',owner_id:'forged',requires_approval:true}}),env)
  expect(response.status).toBe(201)
  const info = await response.json() as {id:string;owner_id:string;invite_token:string}
  expect(info.owner_id).toBe(caller.id)
  const home = await (await worker.fetch(appRequest('/api/caches',{cookie:caller.cookie}),env)).json()
  expect(home).toEqual([{id:info.id,name:'Tools',owner_id:caller.id,requires_approval:true,active_member_count:1,attached_item_count:0,pending_answer_count:0,
    member_preview:[{user_id:caller.id,display_name:'Owner',cat_coat:null,profile_photo_version:null}]}])
  expect(JSON.stringify(home)).not.toContain('example.test')
  const detail = await worker.fetch(appRequest(`/api/caches/${info.id}`,{cookie:caller.cookie}),env)
  expect(await detail.json()).toMatchObject({id:info.id,members:[{user_id:caller.id,display_name:'Owner'}]})
  await env.DB.prepare("UPDATE memberships SET role='member',status='removed' WHERE cache_id=? AND user_id=?").bind(info.id,caller.id).run()
  expect((await worker.fetch(appRequest(`/api/caches/${info.id}`,{cookie:caller.cookie}),env)).status).toBe(404)
  expect((await worker.fetch(appRequest(`/api/caches/${info.id}`,{method:'PATCH',cookie:caller.cookie,body:{name:'Forbidden'}}),env)).status).toBe(404)
})

it('validates cache names/approval fields, profile completion and unsupported destructive paths', async () => {
  const caller = await login()
  expect((await worker.fetch(appRequest('/api/caches',{method:'POST',cookie:caller.cookie,body:{name:'Tools'}}),env)).status).toBe(409)
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:caller.cookie,body:{display_name:'Owner'}}),env)
  for (const body of [{name:''},{name:' '.repeat(3)},{name:'x'.repeat(61)},{name:3},{name:'Tools',requires_approval:'yes'},{}]) {
    expect((await worker.fetch(appRequest('/api/caches',{method:'POST',cookie:caller.cookie,body}),env)).status).toBe(400)
  }
  expect((await worker.fetch(appRequest('/api/caches',{method:'POST',cookie:caller.cookie,origin:null,body:{name:'Tools'}}),env)).status).toBe(403)
  const response = await worker.fetch(appRequest('/api/caches',{method:'POST',cookie:caller.cookie,body:{name:'😀'.repeat(60)}}),env)
  expect(response.status).toBe(201)
  const info = await response.json() as {id:string}
  expect((await worker.fetch(appRequest(`/api/caches/${info.id}`,{method:'DELETE',cookie:caller.cookie}),env)).status).toBe(405)
  expect((await worker.fetch(appRequest(`/api/caches/${info.id}`,{method:'PATCH',cookie:caller.cookie,body:{}}),env)).status).toBe(400)
  expect((await worker.fetch(appRequest(`/api/caches/${info.id}/invite/rotate`,{method:'POST',cookie:caller.cookie,body:{}}),env)).status).toBe(200)
})

it('retains cookie, Origin/profile protection and non-member 404 on Worker item routes', async () => {
  const caller = await login(), path = `/api/caches/${crypto.randomUUID()}/items`
  expect((await worker.fetch(appRequest(path,{method:'POST',body:{}}),env)).status).toBe(401)
  expect((await worker.fetch(appRequest(path,{method:'POST',cookie:caller.cookie,body:{}}),env)).status).toBe(409)
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:caller.cookie,body:{display_name:'Neighbor'}}),env)
  for (const origin of [null,'null','https://foreign.test']) expect((await worker.fetch(appRequest(path,{method:'POST',cookie:caller.cookie,origin,body:{}}),env)).status).toBe(403)
  expect((await worker.fetch(appRequest(path,{method:'POST',cookie:caller.cookie,body:{title:'Mixer',is_consumable:false}}),env)).status).toBe(404)
  expect((await worker.fetch(appRequest(path,{cookie:caller.cookie}),env)).status).toBe(404)
})

it('resumes a body-only invite after onboarding and protects join decisions with CSRF and live D1 authority', async () => {
  const owner = await login('owner@example.test')
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:owner.cookie,body:{display_name:'Owner'}}),env)
  const response = await worker.fetch(appRequest('/api/caches',{method:'POST',cookie:owner.cookie,body:{name:'Tools',requires_approval:true}}),env)
  const info = await response.json() as {id:string;invite_token:string}, secret = info.invite_token.split('.')[1]
  const applicant = await login('applicant@example.test'), path = `/api/caches/${info.id}`
  const post = (route: string,cookie = applicant.cookie,body: unknown = {}) => worker.fetch(appRequest(route,{method:'POST',cookie,body}),env)
  expect((await post(path+'/join',undefined,{secret})).status).toBe(409)
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:applicant.cookie,body:{display_name:'Neighbor'}}),env)
  expect((await worker.fetch(appRequest(path+'/join',{method:'POST',body:{secret}}),env)).status).toBe(401)
  for (const body of [{},{secret:123}]) expect((await post(path+'/join',undefined,body)).status).toBe(400)
  expect((await post(path+'/join',undefined,{secret:'wrong'})).status).toBe(404)
  const decision = `${path}/join-requests/${applicant.id}/approve`
  for (const route of [path+'/join',decision,decision.replace('/approve','/reject')]) {
    for (const origin of [null,'null','https://foreign.test']) expect((await worker.fetch(appRequest(route,{method:'POST',cookie:owner.cookie,origin,body:{secret}}),env)).status).toBe(403)
  }
  expect(await (await post(path+'/join',undefined,{secret,user_id:'forged'})).json()).toEqual({cache_id:info.id,name:'Tools',status:'pending'})
  expect((await worker.fetch(appRequest(path,{cookie:applicant.cookie}),env)).status).toBe(404)
  expect((await worker.fetch(appRequest(path+'/join-requests',{cookie:applicant.cookie}),env)).status).toBe(404)
  expect((await post(decision)).status).toBe(404)
  expect(await (await worker.fetch(appRequest(path+'/join-requests',{cookie:owner.cookie}),env)).json()).toEqual([{user_id:applicant.id,display_name:'Neighbor',cat_coat:null,created_at:expect.any(Number),profile_photo_version:null}])
  expect((await post(`/api/caches/${crypto.randomUUID()}/join-requests/${applicant.id}/approve`,owner.cookie)).status).toBe(404)
  expect((await post(decision,owner.cookie)).status).toBe(200)
  expect((await post(decision.replace('/approve','/reject'),owner.cookie)).status).toBe(409)
  const detail = await worker.fetch(appRequest(path,{cookie:applicant.cookie}),env)
  expect(detail.status).toBe(200)
  expect(JSON.stringify(await detail.json())).not.toContain('example.test')
  await env.DB.prepare("UPDATE memberships SET status='removed' WHERE cache_id=? AND user_id=?").bind(info.id,applicant.id).run()
  expect((await post(path+'/join',undefined,{secret})).status).toBe(403)
  expect((await worker.fetch(appRequest(path,{cookie:applicant.cookie}),env)).status).toBe(404)
  expect((await post(path+'/join/'+secret)).status).toBe(404)
})

it('guards request decision routes and validates party-history pagination', async () => {
  const caller = await login()
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:caller.cookie,body:{display_name:'Neighbor'}}),env)
  const base = `/api/caches/${crypto.randomUUID()}/requests/${crypto.randomUUID()}`
  for (const action of ['approve','reject']) {
    expect((await worker.fetch(appRequest(base+'/'+action,{method:'POST',cookie:caller.cookie,body:action==='reject'?{reason:'Not today'}:{}}),env)).status).toBe(404)
    for (const origin of [null,'null','https://foreign.test']) expect((await worker.fetch(appRequest(base+'/'+action,{method:'POST',cookie:caller.cookie,origin,body:{}}),env)).status).toBe(403)
  }
  expect((await worker.fetch(appRequest('/api/requests?after=bad',{cookie:caller.cookie}),env)).status).toBe(400)
  expect(await (await worker.fetch(appRequest('/api/requests',{cookie:caller.cookie}),env)).json()).toEqual({requests:[],unavailable_cache_ids:[],next_cursor:null})
})

it('guards Worker destructive routes with D1 authority, retaining Origin/profile protection', async () => {
  const caller = await login(), cacheId = crypto.randomUUID()
  const paths = [`/api/caches/${cacheId}/members/${caller.id}`,`/api/caches/${cacheId}/items/${crypto.randomUUID()}`]
  for (const path of paths) expect((await worker.fetch(appRequest(path,{method:'DELETE',cookie:caller.cookie}),env)).status).toBe(409)
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:caller.cookie,body:{display_name:'Neighbor'}}),env)
  for (const path of paths) {
    for (const origin of [null,'null','https://foreign.test']) expect((await worker.fetch(appRequest(path,{method:'DELETE',cookie:caller.cookie,origin}),env)).status).toBe(403)
    const response = await worker.fetch(appRequest(path,{method:'DELETE',cookie:caller.cookie}),env)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({error:'not_found'})
  }
})
