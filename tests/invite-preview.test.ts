import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { cacheDetail, createCache, createItem, invitePreview, joinCache, profilePhotoKey, removeCacheMember, updateCache, updateProfile } from '../src/db'
import { catTraits, type CatCoat } from '../shared/cats'
import { catTraits as appCatTraits } from '../web/src/lib/cats'
import { appRequest, login } from './helpers'

async function user(name: string, coat: CatCoat | null = null) {
  const id = crypto.randomUUID(), now = new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name,cat_coat) VALUES (?,?,?,1,?,?,?,?)')
    .bind(id,`Auth ${name}`,`${id}@example.test`,now,now,name,coat).run()
  return id
}
async function setup(approval = false) {
  const owner = await user('Private Owner','grey'), visitor = await user('Private Visitor')
  const cache = await createCache(env.DB,owner,'Maple St. Neighbors',approval)
  await env.DB.prepare('UPDATE memberships SET created_at=0 WHERE cache_id=?').bind(cache.id).run()
  return {owner,visitor,cache,secret:cache.invite_token.split('.')[1]}
}
async function member(cacheId: string, status: string, index: number, coat: CatCoat | null = null) {
  const id = await user(`Private Member ${index}`,coat)
  await env.DB.prepare("INSERT INTO memberships(cache_id,user_id,role,status,created_at) VALUES (?,?,'member',?,?)").bind(cacheId,id,status,index).run()
  return id
}
function request(cacheId: string, secret: string | null, cookie?: string, method = 'GET') {
  const input = appRequest(`/api/caches/${cacheId}/invite/preview`,{cookie,method})
  const headers = new Headers(input.headers)
  if (secret !== null) headers.set('X-Invite-Secret',secret)
  return new Request(input,{headers})
}

it('returns only the approved name/count/trait tuples in one real guarded D1 statement', async () => {
  const {owner,visitor,cache,secret} = await setup(), other = await member(cache.id,'active',1,'ginger')
  await member(cache.id,'pending',2)
  await member(cache.id,'left',3)
  await member(cache.id,'removed',4)
  const item = await createItem(env.DB,owner,{title:'Private item title',is_consumable:true,quantity:9},cache.id)
  await env.DB.prepare('INSERT INTO user_contacts(user_id,kind,value) VALUES (?,?,?)').bind(owner,'email','private.contact@example.test').run()
  await env.DB.prepare('INSERT INTO user_photos(user_id,photo_path,operation_token) VALUES (?,?,?)').bind(owner,`users/${owner}/${crypto.randomUUID()}`,crypto.randomUUID()).run()
  const prepare = vi.spyOn(env.DB,'prepare')
  const preview = await invitePreview(env.DB,cache.id,visitor,secret)
  expect(prepare).toHaveBeenCalledTimes(1)
  expect(prepare.mock.calls[0][0]).toContain('c.join_secret=?')
  expect(prepare.mock.calls[0][0]).not.toMatch(/display_name|email|photo|items|contacts/)
  prepare.mockRestore()
  expect(preview).toEqual({name:'Maple St. Neighbors',active_member_count:2,members:[catTraits(owner,'grey'),catTraits(other,'ginger')]})
  expect(Object.keys(preview).sort()).toEqual(['active_member_count','members','name'])
  for (const traits of preview.members) expect(Object.keys(traits).sort()).toEqual(['coat','delay','folded','pattern','tip'])
  const json = JSON.stringify(preview)
  for (const privateValue of [owner,other,visitor,cache.id,secret,item.id,'Private Owner','Private Member','Auth ','example.test','Private item title','profile_photo','requires_approval','owner_id']) expect(json).not.toContain(privateValue)
  await expect(cacheDetail(env.DB,cache.id,visitor)).rejects.toMatchObject({status:404})
  await expect(profilePhotoKey(env.DB,owner,visitor)).rejects.toMatchObject({status:404})
})

it('bounds cats at five, counts every active member and preserves deterministic membership ordering', async () => {
  const {owner,visitor,cache,secret} = await setup()
  const members = [owner]
  for (let index=1;index<=7;index++) members.push(await member(cache.id,'active',index))
  await member(cache.id,'pending',8)
  await member(cache.id,'removed',9)
  await member(cache.id,'left',10)
  const preview = await invitePreview(env.DB,cache.id,visitor,secret)
  expect(preview.active_member_count).toBe(8)
  expect(preview.members).toHaveLength(5)
  expect(preview.members).toEqual(members.slice(0,5).map(id=>catTraits(id,id===owner?'grey':null)))
  expect(await invitePreview(env.DB,cache.id,visitor,secret)).toEqual(preview)
})

it('uses the same shared traits as the signed-in app and refreshes only coat on a chosen-coat change', async () => {
  const {owner,visitor,cache,secret} = await setup()
  const before = (await invitePreview(env.DB,cache.id,visitor,secret)).members[0]
  expect(before).toEqual(appCatTraits(owner,'grey'))
  await updateProfile(env.DB,owner,{cat_coat:'toffee'})
  const after = (await invitePreview(env.DB,cache.id,visitor,secret)).members[0]
  expect(after).toEqual(appCatTraits(owner,'toffee'))
  expect({...after,coat:before.coat}).toEqual(before)
})

it('rejects malformed, missing, wrong-cache and rotated secrets without retaining a previous preview grant', async () => {
  const {owner,visitor,cache,secret} = await setup(), otherOwner = await user('Other Owner')
  const other = await createCache(env.DB,otherOwner,'Hidden other cache',false)
  for (const invalid of ['', 'wrong', secret+'A', secret.slice(0,-1)+'B','/'.repeat(43)]) await expect(invitePreview(env.DB,cache.id,visitor,invalid)).rejects.toMatchObject({status:404,code:'not_found'})
  await expect(invitePreview(env.DB,other.id,visitor,secret)).rejects.toMatchObject({status:404,code:'not_found'})
  await expect(invitePreview(env.DB,crypto.randomUUID(),visitor,secret)).rejects.toMatchObject({status:404,code:'not_found'})
  expect((await invitePreview(env.DB,cache.id,visitor,secret)).name).toBe(cache.name)
  const rotated = await updateCache(env.DB,cache.id,owner,{},true)
  await expect(invitePreview(env.DB,cache.id,visitor,secret)).rejects.toMatchObject({status:404,code:'not_found'})
  expect((await invitePreview(env.DB,cache.id,visitor,rotated.invite_token.split('.')[1])).name).toBe(cache.name)
  await env.DB.prepare('DELETE FROM memberships WHERE cache_id=? AND role=\'owner\'').bind(cache.id).run()
  await expect(invitePreview(env.DB,cache.id,visitor,rotated.invite_token.split('.')[1])).rejects.toMatchObject({status:404})
})

it('preserves current-secret removed403, stale-secret404 and voluntary-left preview/rejoin behavior', async () => {
  const {owner,visitor,cache,secret} = await setup()
  await joinCache(env.DB,cache.id,visitor,secret)
  await removeCacheMember(env.DB,cache.id,owner,visitor)
  await expect(invitePreview(env.DB,cache.id,visitor,secret)).rejects.toMatchObject({status:403,code:'member_removed'})
  await expect(joinCache(env.DB,cache.id,visitor,secret)).rejects.toMatchObject({status:403,code:'member_removed'})
  const rotated = await updateCache(env.DB,cache.id,owner,{},true), current = rotated.invite_token.split('.')[1]
  await expect(invitePreview(env.DB,cache.id,visitor,secret)).rejects.toMatchObject({status:404})
  await expect(invitePreview(env.DB,cache.id,visitor,current)).rejects.toMatchObject({status:403})
  const left = await member(cache.id,'left',1)
  expect((await invitePreview(env.DB,cache.id,left,current)).active_member_count).toBe(1)
  expect((await joinCache(env.DB,cache.id,left,current)).membership.status).toBe('active')
})

it('keeps pending and active replays explicit and makes no membership/outbox/write-budget changes on preview', async () => {
  const {visitor,cache,secret} = await setup(true)
  await joinCache(env.DB,cache.id,visitor,secret)
  const before = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM memberships) AS memberships,(SELECT COUNT(*) FROM outbox) AS outbox,(SELECT COUNT(*) FROM write_limits) AS budgets').first()
  expect((await invitePreview(env.DB,cache.id,visitor,secret)).active_member_count).toBe(1)
  expect(await env.DB.prepare('SELECT (SELECT COUNT(*) FROM memberships) AS memberships,(SELECT COUNT(*) FROM outbox) AS outbox,(SELECT COUNT(*) FROM write_limits) AS budgets').first()).toEqual(before)
  expect((await joinCache(env.DB,cache.id,visitor,secret)).membership.status).toBe('pending')
})

it('requires a D1-backed session, accepts only GET, keeps the secret in a header and returns no-store exact error bodies', async () => {
  const {owner,cache,secret} = await setup(), caller = await login('preview-caller@example.test')
  const url = `/api/caches/${cache.id}/invite/preview`
  expect((await worker.fetch(request(cache.id,secret),env)).status).toBe(401)
  const previewRequest = request(cache.id.toUpperCase(),secret,caller.cookie)
  expect(previewRequest.url).not.toContain(secret)
  const success = await worker.fetch(previewRequest,env)
  expect(success.status).toBe(200)
  expect(success.headers.get('Cache-Control')).toBe('no-store')
  expect(await success.json()).toEqual({name:cache.name,active_member_count:1,members:[catTraits(owner,'grey')]})
  for (const method of ['POST','PUT','PATCH','DELETE','HEAD']) expect((await worker.fetch(request(cache.id,secret,caller.cookie,method),env)).status).toBe(405)
  const rotated = await updateCache(env.DB,cache.id,owner,{},true)
  for (const input of [request(cache.id,null,caller.cookie),request(cache.id,secret,caller.cookie),request(crypto.randomUUID(),secret,caller.cookie),appRequest(url.replace(cache.id,'bad-id'),{cookie:caller.cookie})]) {
    const denied = await worker.fetch(input,env)
    expect(denied.status).toBe(404)
    expect(denied.headers.get('Cache-Control')).toBe('no-store')
    expect(await denied.json()).toEqual({error:'not_found'})
  }
  await env.DB.prepare("INSERT INTO memberships(cache_id,user_id,role,status,created_at) VALUES (?,?,'member','removed',1)").bind(cache.id,caller.id).run()
  const removed = await worker.fetch(request(cache.id,rotated.invite_token.split('.')[1],caller.cookie),env)
  expect(removed.status).toBe(403)
  expect(await removed.json()).toEqual({error:'member_removed'})
  await env.DB.prepare('DELETE FROM session WHERE userId=?').bind(caller.id).run()
  expect((await worker.fetch(request(cache.id,rotated.invite_token.split('.')[1],caller.cookie),env)).status).toBe(401)
})
