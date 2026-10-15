import { expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { appRequest, login } from './helpers'

it('Worker routes use canonical D1 authority and enrich only public names', async () => {
  const caller = await login()
  expect((await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:caller.cookie,body:{display_name:'Owner'}}),env)).status).toBe(200)
  const response = await worker.fetch(appRequest('/api/caches',{method:'POST',cookie:caller.cookie,body:{name:'  Tools  ',owner_id:'forged',requires_approval:true}}),env)
  expect(response.status).toBe(201)
  const info = await response.json() as {id:string;owner_id:string;invite_token:string}
  expect(info.owner_id).toBe(caller.id)
  const home = await (await worker.fetch(appRequest('/api/caches',{cookie:caller.cookie}),env)).json()
  expect(home).toEqual([{id:info.id,name:'Tools'}])
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
  expect(await (await worker.fetch(appRequest(path+'/join-requests',{cookie:owner.cookie}),env)).json()).toEqual([{user_id:applicant.id,display_name:'Neighbor',created_at:expect.any(Number)}])
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
