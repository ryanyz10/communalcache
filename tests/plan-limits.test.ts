import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, reset, type D1Migration } from 'cloudflare:test'
import worker from '../src/index'
import { attachItem, createCache, createItem, createRequest, decideCacheJoin, decideRequest, deleteItem, joinCache, removeCacheMember } from '../src/db'
import { itemChanges } from '../src/items'
import { decisionInput } from '../src/requests'
import { sweepPhotoCleanup } from '../src/cleanup'
import { appRequest, authRequest, base, login, mailMock } from './helpers'

const free = {owned_caches:1,new_caches_per_day:2,member_caches:20,cache_members:30,owned_items:100,open_requests:20,photos_per_item:1,profile_photos:1}
const secret = 'A'.repeat(43)
async function users(count = 1) {
  const ids = Array.from({length:count},()=>crypto.randomUUID()), now = new Date().toISOString()
  await env.DB.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) SELECT value,'Neighbor',value||'@example.test',1,?,?,'Neighbor' FROM json_each(?)").bind(now,now,JSON.stringify(ids)).run()
  return ids
}
async function cache(owner: string, approval = false) {
  const id = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO caches(id,name,created_at,join_secret,requires_approval) VALUES (?,?,1,?,?)').bind(id,'Fixture cache',secret,approval?1:0),
    env.DB.prepare("INSERT INTO memberships(cache_id,user_id,role,status,created_at) VALUES (?,?,'owner','active',1)").bind(id,owner),
  ])
  return {id,secret}
}
async function members(cacheId: string, ids: string[], status = 'active') {
  await env.DB.prepare("INSERT INTO memberships(cache_id,user_id,role,status,created_at) SELECT ?,value,'member',?,1 FROM json_each(?)").bind(cacheId,status,JSON.stringify(ids)).run()
}
async function items(owner: string, count: number) {
  const ids = Array.from({length:count},()=>crypto.randomUUID())
  await env.DB.prepare("INSERT INTO items(id,owner_id,title,is_consumable,quantity,created_at) SELECT value,?,'Fixture tool',0,NULL,1 FROM json_each(?)").bind(owner,JSON.stringify(ids)).run()
  return ids
}
async function asks(item: string, cacheId: string, requester: string, count: number) {
  const ids = Array.from({length:count},()=>crypto.randomUUID())
  await env.DB.prepare("INSERT INTO requests(id,item_id,cache_id,requester_id,quantity,status,created_at,creation_token) SELECT value,?,?,?,NULL,'pending',1,value FROM json_each(?)").bind(item,cacheId,requester,JSON.stringify(ids)).run()
  return ids
}
async function active(cacheId: string) { return env.DB.prepare("SELECT COUNT(*) AS n FROM memberships WHERE cache_id=? AND status='active'").bind(cacheId).first<number>('n') }
async function count(table: string) { return env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>('n') }
const tool = () => itemChanges({title:'Tool',is_consumable:false},true)
const limitError = (limit: string) => ({status:409,code:'limit_reached',limit})

it('seeds exactly free/plus with safe defaults and upgrades existing rows without changing domain/auth state', async () => {
  const migrations = (env as unknown as {TEST_MIGRATIONS:D1Migration[]}).TEST_MIGRATIONS
  const migration = migrations.find(row=>row.name.includes('plan_limits'))!
  await reset()
  await applyD1Migrations(env.DB,migrations.filter(row=>row!==migration))
  const [owner] = await users(), existing = await cache(owner), [item] = await items(owner,1)
  const before = await env.DB.prepare('SELECT id,owner_id,title,quantity FROM items').all()
  await applyD1Migrations(env.DB,[migration])
  await applyD1Migrations(env.DB,[migration])
  expect((await env.DB.prepare('SELECT * FROM plan_limits ORDER BY plan').all()).results).toEqual([{plan:'free',...free},{plan:'plus',...free,owned_caches:3,cache_members:100}])
  expect(await env.DB.prepare('SELECT plan FROM user WHERE id=?').bind(owner).first('plan')).toBe('free')
  expect(await env.DB.prepare('SELECT plan FROM caches WHERE id=?').bind(existing.id).first('plan')).toBe('free')
  expect((await env.DB.prepare('SELECT id,owner_id,title,quantity FROM items').all()).results).toEqual(before.results)
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  await expect(env.DB.prepare("UPDATE user SET plan='higher' WHERE id=?").bind(owner).run()).rejects.toThrow()
  await expect(env.DB.prepare("UPDATE caches SET plan='unknown' WHERE id=?").bind(existing.id).run()).rejects.toThrow()
  for (const value of [-1,1.5]) await expect(env.DB.prepare("UPDATE plan_limits SET owned_items=? WHERE plan='free'").bind(value).run()).rejects.toThrow()
  await expect(env.DB.prepare("UPDATE items SET quantity=1 WHERE id=?").bind(item).run()).rejects.toThrow()
  expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name='verification_sign_in_otp_identifier_unique'").first('name')).toBeTruthy()
})

it('allows one free owned cache and rejects a second even after the rolling window expires', async () => {
  const [owner] = await users()
  const first = await createCache(env.DB,owner,'First',false)
  await expect(createCache(env.DB,owner,'Second',false)).rejects.toMatchObject(limitError('owned_caches'))
  await env.DB.prepare('UPDATE caches SET created_at=1 WHERE id=?').bind(first.id).run()
  await expect(createCache(env.DB,owner,'Still blocked',false)).rejects.toMatchObject(limitError('owned_caches'))
  expect(await count('caches')).toBe(1)
  expect(await count('memberships')).toBe(1)
})

it('keeps plus at two creates in rolling 24h and three owned caches, expiring the exact daily boundary', async () => {
  const [owner] = await users(), now = Date.now()
  await env.DB.prepare("UPDATE user SET plan='plus' WHERE id=?").bind(owner).run()
  vi.spyOn(Date,'now').mockReturnValue(now)
  const first = await createCache(env.DB,owner,'First',false)
  await createCache(env.DB,owner,'Second',false)
  await expect(createCache(env.DB,owner,'Blocked',false)).rejects.toMatchObject(limitError('new_caches_per_day'))
  await env.DB.prepare('UPDATE caches SET created_at=? WHERE id=?').bind(now-86_400_000+1,first.id).run()
  await expect(createCache(env.DB,owner,'Still blocked',false)).rejects.toMatchObject(limitError('new_caches_per_day'))
  await env.DB.prepare('UPDATE caches SET created_at=? WHERE id=?').bind(now-86_400_000,first.id).run()
  await createCache(env.DB,owner,'Third',false)
  await expect(createCache(env.DB,owner,'Fourth',false)).rejects.toMatchObject(limitError('owned_caches'))
  expect(await count('caches')).toBe(3)
  expect(await count('memberships')).toBe(3)
})

it('serializes concurrent plus new-cache creates at the rolling quota with no stranded owner rows', async () => {
  const [owner] = await users()
  await env.DB.prepare("UPDATE user SET plan='plus' WHERE id=?").bind(owner).run()
  const results = await Promise.allSettled(Array.from({length:8},()=>createCache(env.DB,owner,'Race',false)))
  expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(2)
  expect(results.filter(row=>row.status==='rejected').every(row=>row.reason.limit==='new_caches_per_day')).toBe(true)
  expect(await count('caches')).toBe(2)
  expect(await count('memberships')).toBe(2)
  expect(await count('outbox')).toBe(0)
})

it('serializes the single free owned-cache slot with no stranded owner rows', async () => {
  const [owner] = await users()
  const results = await Promise.allSettled(Array.from({length:6},()=>createCache(env.DB,owner,'Only slot',false)))
  expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1)
  expect(results.filter(row=>row.status==='rejected').every(row=>row.reason.limit==='owned_caches')).toBe(true)
  expect(await count('caches')).toBe(1)
  expect(await count('memberships')).toBe(1)
})

it('honors an owned-cache policy of zero without a hard-coded fallback', async () => {
  const [owner] = await users()
  await env.DB.prepare("UPDATE plan_limits SET owned_caches=0 WHERE plan='free'").run()
  await expect(createCache(env.DB,owner,'No slot',false)).rejects.toMatchObject(limitError('owned_caches'))
  expect(await count('caches')).toBe(0)
  expect(await count('memberships')).toBe(0)
})

it('preserves existing owned caches on downgrade to free while blocking further growth', async () => {
  const [owner] = await users()
  await env.DB.prepare("UPDATE user SET plan='plus' WHERE id=?").bind(owner).run()
  await createCache(env.DB,owner,'First',false)
  await createCache(env.DB,owner,'Second',false)
  await env.DB.prepare("UPDATE user SET plan='free' WHERE id=?").bind(owner).run()
  await expect(createCache(env.DB,owner,'Third',false)).rejects.toMatchObject(limitError('owned_caches'))
  expect(await count('caches')).toBe(2)
  expect(await count('memberships')).toBe(2)
})

it('guards the initial owner seat using the new cache free plan', async () => {
  const [owner] = await users()
  await env.DB.prepare("UPDATE plan_limits SET cache_members=0 WHERE plan='free'").run()
  await expect(createCache(env.DB,owner,'No owner seat',false)).rejects.toMatchObject(limitError('cache_members'))
  expect(await count('caches')).toBe(0)
  expect(await count('memberships')).toBe(0)
})

it('counts active memberships only and serializes joins in different caches at the account cap', async () => {
  const [admin,caller] = await users(2)
  for(let index=0;index<19;index++)await members((await cache((await users())[0])).id,[caller])
  for(const status of ['pending','left','removed'])await members((await cache((await users())[0])).id,[caller],status)
  const a = await cache(admin), b = await cache((await users())[0])
  const results = await Promise.allSettled([joinCache(env.DB,a.id,caller,secret),joinCache(env.DB,b.id,caller,secret)])
  expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1)
  expect((results.find(row=>row.status==='rejected') as PromiseRejectedResult).reason).toMatchObject(limitError('member_caches'))
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM memberships WHERE user_id=? AND status='active'").bind(caller).first('n')).toBe(20)
  await expect(createCache(env.DB,caller,'Cannot become owner',false)).rejects.toMatchObject(limitError('member_caches'))
})

it('allows pending joins without reserving account seats, rechecks approval, and permits rejection at the cap', async () => {
  const [admin,caller] = await users(2), joined: string[] = []
  for(let index=0;index<20;index++) { const row = await cache((await users())[0]); joined.push(row.id); await members(row.id,[caller]) }
  const target = await cache(admin,true)
  expect((await joinCache(env.DB,target.id,caller,secret)).membership.status).toBe('pending')
  await expect(decideCacheJoin(env.DB,target.id,admin,caller,'approve')).rejects.toMatchObject(limitError('member_caches'))
  expect(await env.DB.prepare('SELECT status FROM memberships WHERE cache_id=? AND user_id=?').bind(target.id,caller).first('status')).toBe('pending')
  expect(await count('outbox')).toBe(1)
  await decideCacheJoin(env.DB,target.id,admin,caller,'reject')
  await joinCache(env.DB,target.id,caller,secret)
  await removeCacheMember(env.DB,joined[0],caller,caller,true)
  await decideCacheJoin(env.DB,target.id,admin,caller,'approve')
  const before = await count('outbox')
  expect((await joinCache(env.DB,target.id,caller,secret)).membership.status).toBe('active')
  expect(await count('outbox')).toBe(before)
})

it('reads the applicant personal plan for open joins and approvals rather than using the cache or owner allowance', async () => {
  const [owner,caller] = await users(2), target = await cache((await users())[0]), gated = await cache(owner,true)
  await cache(caller)
  await env.DB.prepare("UPDATE user SET plan='plus' WHERE id=?").bind(caller).run()
  await env.DB.prepare("UPDATE plan_limits SET member_caches=1 WHERE plan='plus'").run()
  await expect(joinCache(env.DB,target.id,caller,secret)).rejects.toMatchObject(limitError('member_caches'))
  expect((await joinCache(env.DB,gated.id,caller,secret)).membership.status).toBe('pending')
  await expect(decideCacheJoin(env.DB,gated.id,owner,caller,'approve')).rejects.toMatchObject(limitError('member_caches'))
})

it('uses the cache plan, not its owner plan, and does not count pending/left/removed seats', async () => {
  const [owner,a,b] = await users(3), target = await cache(owner)
  await env.DB.prepare("UPDATE user SET plan='plus' WHERE id=?").bind(owner).run()
  await members(target.id,await users(28))
  for(const status of ['pending','left','removed'])await members(target.id,await users(2),status)
  const results = await Promise.allSettled([joinCache(env.DB,target.id,a,secret),joinCache(env.DB,target.id,b,secret)])
  expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1)
  expect((results.find(row=>row.status==='rejected') as PromiseRejectedResult).reason).toMatchObject(limitError('cache_members'))
  expect(await active(target.id)).toBe(30)
})

it('raises only a plus cache member cap to 100 and serializes its last seat', async () => {
  const [owner,a,b] = await users(3), target = await cache(owner)
  await env.DB.prepare("UPDATE caches SET plan='plus' WHERE id=?").bind(target.id).run()
  await members(target.id,await users(98))
  const results = await Promise.allSettled([joinCache(env.DB,target.id,a,secret),joinCache(env.DB,target.id,b,secret)])
  expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1)
  expect((results.find(row=>row.status==='rejected') as PromiseRejectedResult).reason).toMatchObject(limitError('cache_members'))
  expect(await active(target.id)).toBe(100)
  expect(await env.DB.prepare('SELECT plan FROM user WHERE id=?').bind(owner).first('plan')).toBe('free')
})

it('rechecks cache seats on concurrent approvals and never emits an approval outbox for a losing guard', async () => {
  const [owner,a,b] = await users(3), target = await cache(owner,true), existing = await users(29)
  await members(target.id,existing)
  for(const id of [a,b])expect((await joinCache(env.DB,target.id,id,secret)).membership.status).toBe('pending')
  await expect(decideCacheJoin(env.DB,target.id,owner,a,'approve')).rejects.toMatchObject(limitError('cache_members'))
  await removeCacheMember(env.DB,target.id,owner,existing[0])
  const results = await Promise.allSettled([decideCacheJoin(env.DB,target.id,owner,a,'approve'),decideCacheJoin(env.DB,target.id,owner,b,'approve')])
  expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1)
  expect((results.find(row=>row.status==='rejected') as PromiseRejectedResult).reason).toMatchObject(limitError('cache_members'))
  expect(await active(target.id)).toBe(30)
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind='join_approved'").first('n')).toBe(1)
})

it('applies caps to left-member rejoin, preserves removed 403 and keeps active replays idempotent', async () => {
  const [owner,leaver,removed] = await users(3), target = await cache(owner), existing = await users(29)
  await members(target.id,existing)
  await members(target.id,[leaver],'left'); await members(target.id,[removed],'removed')
  await expect(joinCache(env.DB,target.id,leaver,secret)).rejects.toMatchObject(limitError('cache_members'))
  await expect(joinCache(env.DB,target.id,removed,secret)).rejects.toMatchObject({status:403,code:'member_removed'})
  expect((await joinCache(env.DB,target.id,existing[0],secret)).membership.status).toBe('active')
  await removeCacheMember(env.DB,target.id,owner,existing[0])
  expect((await joinCache(env.DB,target.id,leaver,secret)).membership.status).toBe('active')
  expect(await active(target.id)).toBe(30)
})

it('guards the last library slot across private and atomic create-and-attach without counting attachments', async () => {
  const [owner,other] = await users(2), a = await cache(owner), b = await cache(other), seeded = await items(owner,99)
  await members(b.id,[owner])
  await items(other,3)
  const results = await Promise.allSettled([createItem(env.DB,owner,tool()),createItem(env.DB,owner,tool(),a.id)])
  expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1)
  expect((results.find(row=>row.status==='rejected') as PromiseRejectedResult).reason).toMatchObject(limitError('owned_items'))
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM items WHERE owner_id=?').bind(owner).first('n')).toBe(100)
  await attachItem(env.DB,seeded[0],a.id,owner); await attachItem(env.DB,seeded[0],b.id,owner)
  await expect(createItem(env.DB,owner,tool(),a.id)).rejects.toMatchObject(limitError('owned_items'))
  await expect(createItem(env.DB,owner,tool(),crypto.randomUUID())).rejects.toMatchObject({status:404})
  await deleteItem(env.DB,seeded[0],owner)
  await createItem(env.DB,owner,tool(),a.id)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM items WHERE owner_id=?').bind(owner).first('n')).toBe(100)
})

it('caps all-cache pending outgoing requests at 20 and decisions release slots without a loan lifecycle', async () => {
  const [owner,caller,admin] = await users(3), a = await cache(owner), b = await cache(admin)
  await members(b.id,[owner])
  for(const row of [a,b])await members(row.id,[caller])
  const item = await createItem(env.DB,owner,tool(),a.id)
  await attachItem(env.DB,item.id,b.id,owner)
  const pending = await asks(item.id,a.id,caller,19)
  const results = await Promise.allSettled([createRequest(env.DB,item.id,a.id,caller,null),createRequest(env.DB,item.id,b.id,caller,null)])
  expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1)
  expect((results.find(row=>row.status==='rejected') as PromiseRejectedResult).reason).toMatchObject(limitError('open_requests'))
  expect(await count('outbox')).toBe(1)
  await decideRequest(env.DB,pending[0],owner,'approve',decisionInput({},'approve'))
  await createRequest(env.DB,item.id,b.id,caller,null)
  await decideRequest(env.DB,pending[1],owner,'reject',decisionInput({reason:'Not today'},'reject'))
  await createRequest(env.DB,item.id,a.id,caller,null)
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE requester_id=? AND status='pending'").bind(caller).first('n')).toBe(20)
})

it('reads changed table limits inside the write and fails closed if a plan row is missing', async () => {
  const [owner] = await users()
  await env.DB.prepare("UPDATE plan_limits SET owned_items=0 WHERE plan='free'").run()
  await expect(createItem(env.DB,owner,tool())).rejects.toMatchObject(limitError('owned_items'))
  expect(await count('items')).toBe(0)
  await env.DB.prepare("DELETE FROM plan_limits WHERE plan='free'").run()
  await expect(createItem(env.DB,owner,tool())).rejects.toMatchObject({status:503,code:'limits_unavailable'})
  await expect(createCache(env.DB,owner,'No fallback',false)).rejects.toMatchObject({status:503,code:'limits_unavailable'})
  expect(await count('caches')).toBe(0)
})

it('serializes plan downgrades against joins without deleting admitted memberships', async () => {
  for(const downgradeFirst of [false,true]) {
    const [owner,caller] = await users(2), target = await cache(owner)
    await env.DB.prepare("UPDATE caches SET plan='plus' WHERE id=?").bind(target.id).run()
    await members(target.id,await users(29))
    const downgrade = ()=>env.DB.prepare("UPDATE caches SET plan='free' WHERE id=?").bind(target.id).run()
    const join = ()=>joinCache(env.DB,target.id,caller,secret)
    const results = await Promise.allSettled(downgradeFirst?[downgrade(),join()]:[join(),downgrade()])
    expect(results[downgradeFirst?0:1].status).toBe('fulfilled')
    const joined = results[downgradeFirst?1:0]
    expect(await active(target.id)).toBe(joined.status==='fulfilled'?31:30)
    await expect(joinCache(env.DB,target.id,(await users())[0],secret)).rejects.toMatchObject(limitError('cache_members'))
  }
})

it('serializes a limits-table edit against item creation and blocks later growth without deleting existing items', async () => {
  const [owner] = await users()
  await items(owner,1)
  const results = await Promise.allSettled([createItem(env.DB,owner,tool()),env.DB.prepare("UPDATE plan_limits SET owned_items=1 WHERE plan='free'").run()])
  expect(results[1].status).toBe('fulfilled')
  expect(await count('items')).toBe(results[0].status==='fulfilled'?2:1)
  await expect(createItem(env.DB,owner,tool())).rejects.toMatchObject(limitError('owned_items'))
})

it('never accepts plan assignment through public profile/cache writes and serializes limit metadata as 409 JSON', async () => {
  const owner = await login()
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:owner.cookie,body:{display_name:'Owner',plan:'plus'}}),env)
  const response = await worker.fetch(appRequest('/api/caches',{method:'POST',cookie:owner.cookie,body:{name:'One',plan:'plus'}}),env)
  expect(response.status).toBe(201)
  const created = await response.json() as {id:string}
  await worker.fetch(appRequest(`/api/caches/${created.id}`,{method:'PATCH',cookie:owner.cookie,body:{name:'Still free',plan:'plus'}}),env)
  expect(await env.DB.prepare('SELECT plan FROM user WHERE id=?').bind(owner.id).first('plan')).toBe('free')
  expect(await env.DB.prepare('SELECT plan FROM caches WHERE id=?').bind(created.id).first('plan')).toBe('free')
  const limited = await worker.fetch(appRequest('/api/caches',{method:'POST',cookie:owner.cookie,body:{name:'Two'}}),env)
  expect(limited.status).toBe(409)
  expect(limited.headers.get('Cache-Control')).toBe('no-store')
  expect(await limited.json()).toEqual({error:'limit_reached',limit:'owned_caches'})
})

it('keeps a new auth user free even when the sign-in body supplies a plan', async () => {
  const codes = mailMock(), email = 'new-user@example.test'
  expect((await worker.fetch(authRequest('/email-otp/send-verification-otp',{email,type:'sign-in'}),env)).status).toBe(200)
  expect((await worker.fetch(authRequest('/sign-in/email-otp',{email,otp:codes.at(-1),plan:'plus'}),env)).status).toBe(200)
  expect(await env.DB.prepare('SELECT plan FROM user WHERE email=?').bind(email).first('plan')).toBe('free')
})

it('returns request-cap metadata over HTTP without creating a request or notification', async () => {
  const owner = await login('owner@example.test'), caller = await login('caller@example.test')
  for(const user of [owner,caller])await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:user.cookie,body:{display_name:'Neighbor'}}),env)
  const target = await cache(owner.id)
  await members(target.id,[caller.id])
  const item = await createItem(env.DB,owner.id,tool(),target.id)
  await asks(item.id,target.id,caller.id,20)
  const response = await worker.fetch(appRequest(`/api/caches/${target.id}/items/${item.id}/requests`,{method:'POST',cookie:caller.cookie,body:{}}),env)
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({error:'limit_reached',limit:'open_requests'})
  expect(await count('requests')).toBe(20)
  expect(await count('outbox')).toBe(0)
})

it('reports the photo guard snapshot even if rejected-key cleanup restores its allowance afterward', async () => {
  const owner = await login()
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:owner.cookie,body:{display_name:'Owner'}}),env)
  const item = await createItem(env.DB,owner.id,tool())
  await env.DB.prepare("UPDATE plan_limits SET photos_per_item=0 WHERE plan='free'").run()
  await env.DB.exec("CREATE TRIGGER restore_photo_limit AFTER INSERT ON r2_cleanup BEGIN UPDATE plan_limits SET photos_per_item=1 WHERE plan='free'; END")
  const response = await worker.fetch(new Request(base+`/api/me/items/${item.id}/photo`,{method:'POST',headers:{Origin:base,Cookie:owner.cookie,'Content-Type':'image/png'},body:new Uint8Array([137,80,78,71,13,10,26,10])}),env)
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({error:'limit_reached',limit:'photos_per_item'})
  expect(await env.DB.prepare("SELECT photos_per_item FROM plan_limits WHERE plan='free'").first('photos_per_item')).toBe(1)
  expect(await env.DB.prepare('SELECT photo_path FROM items WHERE id=?').bind(item.id).first('photo_path')).toBeNull()
  expect(await count('r2_cleanup')).toBe(1)
})

it('preserves one current photo during replacement and rechecks its allowance after R2 I/O', async () => {
  const owner = await login()
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:owner.cookie,body:{display_name:'Owner'}}),env)
  const item = await createItem(env.DB,owner.id,tool()), path = `/api/me/items/${item.id}/photo`
  const upload = ()=>new Request(base+path,{method:'POST',headers:{Origin:base,Cookie:owner.cookie,'Content-Type':'image/png'},body:new Uint8Array([137,80,78,71,13,10,26,10])})
  expect((await worker.fetch(upload(),env)).status).toBe(200)
  const first = await env.DB.prepare('SELECT photo_path FROM items WHERE id=?').bind(item.id).first<string>('photo_path')
  expect((await worker.fetch(upload(),env)).status).toBe(200)
  const current = await env.DB.prepare('SELECT photo_path FROM items WHERE id=?').bind(item.id).first<string>('photo_path')
  expect(current).not.toBe(first)
  await env.DB.prepare("UPDATE plan_limits SET photos_per_item=0 WHERE plan='plus'").run()
  const put = env.BUCKET.put.bind(env.BUCKET)
  vi.spyOn(env.BUCKET,'put').mockImplementation(async(key,body,options)=>{
    const result = await put(key,body,options)
    await env.DB.prepare("UPDATE user SET plan='plus' WHERE id=?").bind(owner.id).run()
    return result
  })
  const response = await worker.fetch(upload(),env)
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({error:'limit_reached',limit:'photos_per_item'})
  expect(await env.DB.prepare('SELECT photo_path FROM items WHERE id=?').bind(item.id).first('photo_path')).toBe(current)
  for(let tick=0;tick<3;tick++)await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(current!)).not.toBeNull()
  expect((await env.BUCKET.list({prefix:`${owner.id}/${item.id}/`})).objects.map(row=>row.key)).toEqual([current])
})
