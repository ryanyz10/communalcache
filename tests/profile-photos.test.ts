import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, reset, type D1Migration } from 'cloudflare:test'
import worker from '../src/index'
import { cacheDetail, cacheItems, claimCleanup, createCache, createItem, createRequest, decideRequest, finishProfilePhoto, getProfile, itemDetail, joinCache, profilePhotoKey, removeCacheMember, requestsPage } from '../src/db'
import { sweepPhotoCleanup } from '../src/cleanup'
import { itemChanges } from '../src/items'
import { decisionInput } from '../src/requests'
import { appRequest, base, login } from './helpers'

const png = new Uint8Array([137,80,78,71,13,10,26,10])
async function profile(email: string) {
  const caller = await login(email)
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:caller.cookie,body:{display_name:email.split('@')[0]}}),env)
  return caller
}
async function fixture() {
  const owner = await profile('owner@example.test'), member = await profile('member@example.test'), other = await profile('other@example.test'), outsider = await profile('outsider@example.test')
  await env.DB.prepare("UPDATE user SET plan='plus' WHERE id=?").bind(owner.id).run()
  const a = await createCache(env.DB,owner.id,'Tools',false), b = await createCache(env.DB,owner.id,'Garden',false)
  await joinCache(env.DB,a.id,member.id,a.invite_token.split('.')[1])
  await joinCache(env.DB,b.id,other.id,b.invite_token.split('.')[1])
  return {owner,member,other,outsider,a,b,path:`/api/users/${owner.id}/photo`}
}
function upload(cookie: string, bytes: BodyInit = png, type = 'image/png', origin: string | null = base) {
  return new Request(base+'/api/me/photo',{method:'POST',headers:{Cookie:cookie,'Content-Type':type,...(origin===null?{}:{Origin:origin})},body:bytes})
}
function pointer(userId: string) { return env.DB.prepare('SELECT photo_path FROM user_photos WHERE user_id=?').bind(userId).first<string>('photo_path') }
function cleanup() { return env.DB.prepare('SELECT id,owner_id,item_id,kind,target,scope FROM r2_cleanup ORDER BY target').all<{id:string;owner_id:string;item_id:string|null;kind:string;target:string;scope:string}>() }

it('upgrades cleanup scope without losing item work, claims or cursors and constrains profile intents to exact user keys', async () => {
  const migrations = (env as unknown as {TEST_MIGRATIONS:D1Migration[]}).TEST_MIGRATIONS
  const migration = migrations.find(row=>row.name.includes('profile_photos'))!
  await reset()
  await applyD1Migrations(env.DB,migrations.filter(row=>row!==migration))
  const owner = crypto.randomUUID(), item = crypto.randomUUID(), id = crypto.randomUUID(), key = `${owner}/${item}/${crypto.randomUUID()}`
  await env.DB.prepare("INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at,claim_token,claim_until) VALUES (?,?,?,'exact',?,1,'old-claim',9999999999999)").bind(id,owner,item,key).run()
  await env.DB.prepare('UPDATE r2_cleanup_cursor SET cleanup_id=?').bind(id).run()
  await applyD1Migrations(env.DB,[migration])
  expect(await env.DB.prepare('SELECT * FROM r2_cleanup WHERE id=?').bind(id).first()).toEqual({id,owner_id:owner,item_id:item,kind:'exact',target:key,created_at:1,claim_token:'old-claim',claim_until:9999999999999,scope:'item'})
  expect(await env.DB.prepare('SELECT cleanup_id FROM r2_cleanup_cursor').first('cleanup_id')).toBe(id)
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  for(const [scope,itemId,kind] of [['profile',item,'exact'],['profile',null,'prefix'],['item',null,'exact']] as const) {
    await expect(env.DB.prepare('INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at,scope) VALUES (?,?,?,?,?,1,?)').bind(crypto.randomUUID(),owner,itemId,kind,crypto.randomUUID(),scope).run()).rejects.toThrow()
  }
})

it('uploads immutable self-owned photos and authorizes self/shared-active reads before private R2 streaming', async () => {
  const f = await fixture(), uploaded = await worker.fetch(upload(f.owner.cookie),env)
  expect(uploaded.status).toBe(200)
  const me = await uploaded.json() as {profile_photo_version:string}
  const key = await pointer(f.owner.id)
  expect(key).toBe(`users/${f.owner.id}/${me.profile_photo_version}`)
  for(const [path,cookie] of [['/api/me/photo',f.owner.cookie],[f.path,f.member.cookie],[f.path.replace(f.owner.id,f.owner.id.toUpperCase()),f.other.cookie]]) {
    const response = await worker.fetch(new Request(base+path+'?v=untrusted',{headers:{Cookie:cookie,'If-None-Match':'*'}}),env)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png)
  }
  const prepare = vi.spyOn(env.DB,'prepare')
  expect(await profilePhotoKey(env.DB,f.owner.id,f.member.id)).toBe(key)
  expect(prepare).toHaveBeenCalledTimes(1)
  expect(prepare.mock.calls[0][0]).toContain("caller.status='active'")
  expect(prepare.mock.calls[0][0]).toContain("owner.status='active'")
  const get = vi.spyOn(env.BUCKET,'get')
  get.mockClear()
  for(const cookie of [undefined,f.outsider.cookie]) expect((await worker.fetch(appRequest(f.path,{cookie}),env)).status).toBe(404)
  expect(get).not.toHaveBeenCalled()
  expect((await worker.fetch(appRequest(`/api/users/${f.owner.id}/photo`,{method:'DELETE',cookie:f.member.cookie}),env)).status).toBe(405)
})

for(const leaving of [false,true]) {
  it(`denies the next read after the reader is ${leaving?'left':'removed'}, keeping self and other-shared-cache access`, async () => {
    const f = await fixture()
    await worker.fetch(upload(f.owner.cookie),env)
    const key = await pointer(f.owner.id)
    await removeCacheMember(env.DB,f.a.id,leaving?f.member.id:f.owner.id,f.member.id,leaving)
    expect((await worker.fetch(appRequest(f.path,{cookie:f.member.cookie}),env)).status).toBe(404)
    expect((await worker.fetch(appRequest(f.path,{cookie:f.other.cookie}),env)).status).toBe(200)
    expect((await worker.fetch(appRequest('/api/me/photo',{cookie:f.owner.cookie}),env)).status).toBe(200)
    expect(await env.BUCKET.head(key!)).not.toBeNull()
    expect((await cleanup()).results).toEqual([])
  })
}

it('requires both sides active in the same cache, including when the photo owner loses membership', async () => {
  const f = await fixture()
  await worker.fetch(upload(f.member.cookie),env)
  const path = `/api/users/${f.member.id}/photo`
  expect((await worker.fetch(appRequest(path,{cookie:f.owner.cookie}),env)).status).toBe(200)
  for(const status of ['pending','left','removed']) {
    await env.DB.prepare('UPDATE memberships SET status=? WHERE cache_id=? AND user_id=?').bind(status,f.a.id,f.member.id).run()
    expect((await worker.fetch(appRequest(path,{cookie:f.owner.cookie}),env)).status).toBe(404)
    expect((await worker.fetch(appRequest('/api/me/photo',{cookie:f.member.cookie}),env)).status).toBe(200)
  }
  expect((await worker.fetch(appRequest(path,{cookie:f.other.cookie}),env)).status).toBe(404)
})

it('retains reads through a second shared cache and revokes them only when the last shared membership is lost', async () => {
  const f = await fixture()
  await worker.fetch(upload(f.owner.cookie),env)
  await joinCache(env.DB,f.b.id,f.member.id,f.b.invite_token.split('.')[1])
  await removeCacheMember(env.DB,f.a.id,f.member.id,f.member.id,true)
  expect((await worker.fetch(appRequest(f.path,{cookie:f.member.cookie}),env)).status).toBe(200)
  await removeCacheMember(env.DB,f.b.id,f.member.id,f.member.id,true)
  expect((await worker.fetch(appRequest(f.path,{cookie:f.member.cookie}),env)).status).toBe(404)
})

it('returns guarded avatar metadata wherever names appear without exposing another email or an R2 key', async () => {
  const f = await fixture()
  await worker.fetch(upload(f.owner.cookie),env); await worker.fetch(upload(f.member.cookie),env)
  const ownerVersion = (await getProfile(env.DB,f.owner.id))!.profile_photo_version
  const memberVersion = (await getProfile(env.DB,f.member.id))!.profile_photo_version
  const item = await createItem(env.DB,f.owner.id,itemChanges({title:'Mixer',is_consumable:false},true),f.a.id)
  const request = await createRequest(env.DB,item.id,f.a.id,f.member.id,null)
  expect(request.request).toMatchObject({owner_photo_version:ownerVersion,requester_photo_version:memberVersion})
  expect((await cacheDetail(env.DB,f.a.id,f.member.id)).members).toEqual(expect.arrayContaining([
    expect.objectContaining({user_id:f.owner.id,profile_photo_version:ownerVersion}),expect.objectContaining({user_id:f.member.id,profile_photo_version:memberVersion}),
  ]))
  expect((await cacheItems(env.DB,f.a.id,f.member.id))[0].owner_photo_version).toBe(ownerVersion)
  expect((await itemDetail(env.DB,item.id,f.member.id,f.a.id)).owner_photo_version).toBe(ownerVersion)
  for(const path of [`/api/caches/${f.a.id}`,`/api/caches/${f.a.id}/items`,`/api/caches/${f.a.id}/items/${item.id}`,`/api/caches/${f.a.id}/items/${item.id}/requests`,'/api/requests']) {
    const response = await worker.fetch(appRequest(path,{cookie:f.member.cookie}),env)
    expect(response.status).toBe(200)
    const payload = JSON.stringify(await response.json())
    expect(payload).toContain(ownerVersion!)
    for(const forbidden of ['@example.test','users/','photo_path','operation_token'])expect(payload).not.toContain(forbidden)
  }
  await decideRequest(env.DB,request.request.id,f.owner.id,'approve',decisionInput({},'approve'))
  await removeCacheMember(env.DB,f.a.id,f.member.id,f.member.id,true)
  const history = await requestsPage(env.DB,f.member.id,null)
  expect(history.requests[0]).toMatchObject({owner_photo_version:null,requester_photo_version:memberVersion,status:'approved'})
  expect((await worker.fetch(appRequest(f.path,{cookie:f.member.cookie}),env)).status).toBe(404)
  await joinCache(env.DB,f.b.id,f.member.id,f.b.invite_token.split('.')[1])
  expect((await requestsPage(env.DB,f.member.id,null)).requests[0].owner_photo_version).toBe(ownerVersion)
  expect((await worker.fetch(appRequest(`/api/caches/${f.a.id}/items/${item.id}`,{cookie:f.member.cookie}),env)).status).toBe(404)
  const auth = await worker.fetch(appRequest('/api/auth/get-session',{cookie:f.owner.cookie}),env)
  const authPayload = JSON.stringify(await auth.json())
  for(const forbidden of ['photo_path','operation_token','users/'])expect(authPayload).not.toContain(forbidden)
})

it('atomically snapshots replaced/removed exact-key cleanup with explicit profile scope and allows removal at limit zero', async () => {
  const owner = await profile('owner@example.test')
  await worker.fetch(upload(owner.cookie),env)
  const first = (await pointer(owner.id))!
  await worker.fetch(upload(owner.cookie),env)
  const second = (await pointer(owner.id))!
  expect(second).not.toBe(first)
  expect((await cleanup()).results).toEqual([expect.objectContaining({owner_id:owner.id,item_id:null,scope:'profile',kind:'exact',target:first})])
  await env.DB.prepare("UPDATE plan_limits SET profile_photos=0 WHERE plan='free'").run()
  expect((await worker.fetch(appRequest('/api/me/photo',{method:'DELETE',cookie:owner.cookie}),env)).status).toBe(204)
  expect(await pointer(owner.id)).toBeNull()
  expect((await getProfile(env.DB,owner.id))!.profile_photo_version).toBeNull()
  expect((await cleanup()).results.map(row=>row.target).sort()).toEqual([first,second].sort())
  expect(await env.BUCKET.head(first)).not.toBeNull()
  for(let tick=0;tick<3;tick++)await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(first)).toBeNull(); expect(await env.BUCKET.head(second)).toBeNull()
  expect((await worker.fetch(appRequest('/api/me/photo',{method:'DELETE',cookie:owner.cookie}),env)).status).toBe(204)
})

it('denies limit zero and post-R2 plan changes without replacing the current photo, retaining rejected-key cleanup', async () => {
  const owner = await profile('owner@example.test')
  await worker.fetch(upload(owner.cookie),env)
  const current = await pointer(owner.id)
  await env.DB.prepare("UPDATE plan_limits SET profile_photos=0 WHERE plan='plus'").run()
  const put = env.BUCKET.put.bind(env.BUCKET)
  vi.spyOn(env.BUCKET,'put').mockImplementation(async(key,body,options)=>{
    const result = await put(key,body,options)
    await env.DB.prepare("UPDATE user SET plan='plus' WHERE id=?").bind(owner.id).run()
    return result
  })
  const response = await worker.fetch(upload(owner.cookie),env)
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({error:'limit_reached',limit:'profile_photos'})
  expect(await pointer(owner.id)).toBe(current)
  expect((await cleanup()).results).toHaveLength(1)
  await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(current!)).not.toBeNull()
})

it('rechecks that the user exists after R2 put and retains cleanup without a source-user FK', async () => {
  const owner = await profile('owner@example.test'), put = env.BUCKET.put.bind(env.BUCKET)
  vi.spyOn(env.BUCKET,'put').mockImplementation(async(key,body,options)=>{
    const result = await put(key,body,options)
    await env.DB.prepare('DELETE FROM user WHERE id=?').bind(owner.id).run()
    return result
  })
  expect((await worker.fetch(upload(owner.cookie),env)).status).toBe(404)
  expect(await pointer(owner.id)).toBeNull()
  const rows = (await cleanup()).results
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({owner_id:owner.id,item_id:null,scope:'profile'})
  await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(rows[0].target)).toBeNull()
})

it('records known cleanup after an uncertain R2 response and preserves current data', async () => {
  const owner = await profile('owner@example.test')
  await worker.fetch(upload(owner.cookie),env)
  const current = await pointer(owner.id), put = env.BUCKET.put.bind(env.BUCKET)
  vi.spyOn(env.BUCKET,'put').mockImplementation(async(key,body,options)=>{await put(key,body,options);throw new Error('uncertain R2 response')})
  expect((await worker.fetch(upload(owner.cookie),env)).status).toBe(500)
  expect(await pointer(owner.id)).toBe(current)
  const rows = (await cleanup()).results
  expect(rows).toHaveLength(1)
  await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(rows[0].target)).toBeNull()
  expect(await env.BUCKET.head(current!)).not.toBeNull()
})

it('serializes remove versus replace without deleting a final current photo or losing cleanup', async () => {
  const owner = await profile('owner@example.test')
  await worker.fetch(upload(owner.cookie),env)
  const results = await Promise.all([worker.fetch(appRequest('/api/me/photo',{method:'DELETE',cookie:owner.cookie}),env),worker.fetch(upload(owner.cookie),env)])
  expect(results.map(row=>row.status)).toEqual([204,200])
  const current = await pointer(owner.id)
  for(let tick=0;tick<4;tick++)await sweepPhotoCleanup(env)
  expect((await env.BUCKET.list({prefix:`users/${owner.id}/`})).objects.map(row=>row.key)).toEqual(current?[current]:[])
})

it('keeps exactly one current photo under concurrent replacement and never cleans the current key', async () => {
  const owner = await profile('owner@example.test')
  await worker.fetch(upload(owner.cookie),env)
  const results = await Promise.all([worker.fetch(upload(owner.cookie),env),worker.fetch(upload(owner.cookie),env)])
  expect(results.every(row=>row.status===200)).toBe(true)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user_photos WHERE user_id=?').bind(owner.id).first('n')).toBe(1)
  const current = (await pointer(owner.id))!, rows = (await cleanup()).results
  expect(rows).toHaveLength(2)
  expect(rows.every(row=>row.target!==current && row.scope==='profile' && row.item_id===null)).toBe(true)
  await finishProfilePhoto(env.DB,owner.id,current,false)
  for(let tick=0;tick<3;tick++)await sweepPhotoCleanup(env)
  expect((await env.BUCKET.list({prefix:`users/${owner.id}/`})).objects.map(row=>row.key)).toEqual([current])
})

it('rolls pointer/token/replacement cleanup back on SQL failure and records cleanup for already-written rejected bytes', async () => {
  const owner = await profile('owner@example.test')
  await worker.fetch(upload(owner.cookie),env)
  const before = await env.DB.prepare('SELECT * FROM user_photos WHERE user_id=?').bind(owner.id).first()
  await env.DB.exec("CREATE TRIGGER fail_profile_cleanup BEFORE INSERT ON r2_cleanup WHEN NEW.target=(SELECT photo_path FROM user_photos LIMIT 1) BEGIN SELECT RAISE(ABORT,'injected profile cleanup failure'); END")
  expect((await worker.fetch(upload(owner.cookie),env)).status).toBe(500)
  expect(await env.DB.prepare('SELECT * FROM user_photos WHERE user_id=?').bind(owner.id).first()).toEqual(before)
  const rows = (await cleanup()).results
  expect(rows).toHaveLength(1)
  expect(rows[0].target).not.toBe(await pointer(owner.id))
  await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(rows[0].target)).toBeNull()
})

it('rolls removal and its cleanup back together when final source deletion fails', async () => {
  const owner = await profile('owner@example.test')
  await worker.fetch(upload(owner.cookie),env)
  const before = await env.DB.prepare('SELECT * FROM user_photos WHERE user_id=?').bind(owner.id).first()
  await env.DB.exec("CREATE TRIGGER fail_profile_remove BEFORE DELETE ON user_photos BEGIN SELECT RAISE(ABORT,'injected profile remove failure'); END")
  expect((await worker.fetch(appRequest('/api/me/photo',{method:'DELETE',cookie:owner.cookie}),env)).status).toBe(500)
  expect(await env.DB.prepare('SELECT * FROM user_photos WHERE user_id=?').bind(owner.id).first()).toEqual(before)
  expect((await cleanup()).results).toEqual([])
})

it('retains retryable profile cleanup through R2 failures and protects current/external-scope keys', async () => {
  const owner = await profile('owner@example.test')
  await worker.fetch(upload(owner.cookie),env)
  const current = (await pointer(owner.id))!, orphan = `users/${owner.id}/${crypto.randomUUID()}`
  await env.BUCKET.put(orphan,'known orphan')
  const id = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at,scope) VALUES (?,?,NULL,'exact',?,1,'profile')").bind(id,owner.id,orphan).run()
  const remove = vi.spyOn(env.BUCKET,'delete').mockRejectedValue(new Error('injected R2 failure'))
  await sweepPhotoCleanup(env)
  expect((await cleanup()).results).toHaveLength(1)
  remove.mockRestore(); await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(orphan)).toBeNull()
  const protectedId = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at,scope) VALUES (?,?,NULL,'exact',?,1,'profile')").bind(protectedId,owner.id,current).run()
  expect(await claimCleanup(env.DB,protectedId,crypto.randomUUID(),Date.now())).toBeNull()
  const foreign = `users/${crypto.randomUUID()}/${crypto.randomUUID()}`
  await env.BUCKET.put(foreign,'keep')
  await env.DB.prepare("INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at,scope) VALUES (?,?,NULL,'exact',?,1,'profile')").bind(crypto.randomUUID(),owner.id,foreign).run()
  for(let tick=0;tick<3;tick++)await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(current)).not.toBeNull()
  expect(await env.BUCKET.head(foreign)).not.toBeNull()
})

it('rejects invalid scope/type/size/Origin/profile inputs before unsafe writes and exposes no generic user lookup', async () => {
  const owner = await profile('owner@example.test'), put = vi.spyOn(env.BUCKET,'put')
  for(const origin of [null,'null','https://foreign.test'])for(const method of ['POST','DELETE']) {
    const request = method==='POST'?upload(owner.cookie,png,'image/png',origin):appRequest('/api/me/photo',{method,cookie:owner.cookie,origin})
    expect((await worker.fetch(request,env)).status).toBe(403)
  }
  expect((await worker.fetch(upload(owner.cookie,'<svg/>','image/jpeg'),env)).status).toBe(415)
  const large = new Uint8Array(5*1024*1024+1)
  expect((await worker.fetch(upload(owner.cookie,large),env)).status).toBe(413)
  await env.DB.prepare('UPDATE user SET display_name=NULL WHERE id=?').bind(owner.id).run()
  expect((await worker.fetch(upload(owner.cookie),env)).status).toBe(409)
  expect(put).not.toHaveBeenCalled()
  await expect(finishProfilePhoto(env.DB,owner.id,`users/${crypto.randomUUID()}/${crypto.randomUUID()}`,true)).rejects.toMatchObject({status:404})
  expect((await worker.fetch(appRequest(`/api/users/${owner.id}`,{cookie:owner.cookie}),env)).status).toBe(404)
})
