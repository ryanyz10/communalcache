import { expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { attachItem, cacheDetail, cacheItems, createCache, createItem, createRequest, homeSummary, joinCache, listMyCaches, removeCacheMember } from '../src/db'
import { itemChanges } from '../src/items'
import { appRequest, login } from './helpers'

async function user(name: string) {
  const id=crypto.randomUUID(), now=new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name,cat_coat) VALUES (?,\'\',?,1,?,?,?,\'oat\')').bind(id,`${id}@example.com`,now,now,name).run()
  return id
}
async function fixture() {
  const owner=await user('Owner'), member=await user('Member'), outsider=await user('Private requester')
  const a=await createCache(env.DB,owner,'Neighbors',false), b=await createCache(env.DB,outsider,'Private',false)
  await joinCache(env.DB,a.id,member,a.invite_token.split('.')[1])
  await joinCache(env.DB,b.id,owner,b.invite_token.split('.')[1])
  const item=await createItem(env.DB,owner,itemChanges({title:'Jars',is_consumable:true,quantity:100},true),a.id)
  await attachItem(env.DB,item.id,b.id,owner)
  await createItem(env.DB,owner,itemChanges({title:'Private library',is_consumable:false},true))
  await createRequest(env.DB,item.id,a.id,member,2)
  await createRequest(env.DB,item.id,b.id,outsider,3)
  return {owner,member,outsider,a,b,item}
}

it('aggregates canonical attachments, true active counts and caller-inclusive bounded rooftops without emails/secrets',async()=>{
  const f=await fixture()
  for(let n=0;n<4;n++) await joinCache(env.DB,f.a.id,await user(`Neighbor ${n}`),f.a.invite_token.split('.')[1])
  const caches=(await listMyCaches(env.DB,f.owner)).results
  const a=caches.find(c=>c.id===f.a.id)!, b=caches.find(c=>c.id===f.b.id)!
  expect(a).toMatchObject({owner_id:f.owner,requires_approval:false,active_member_count:6,attached_item_count:1,pending_answer_count:1})
  expect(b).toMatchObject({active_member_count:2,attached_item_count:1,pending_answer_count:1})
  expect(a.member_preview).toHaveLength(3)
  expect(a.member_preview[0]).toMatchObject({user_id:f.owner,cat_coat:'oat',profile_photo_version:null})
  expect((await listMyCaches(env.DB,f.member)).results).toEqual([expect.objectContaining({id:f.a.id,pending_answer_count:0})])
  const detail=await cacheDetail(env.DB,f.a.id,f.member)
  expect(detail.members.find(m=>m.user_id===f.owner)?.attached_item_count).toBe(1)
  expect(detail.members.find(m=>m.user_id===f.member)?.attached_item_count).toBe(0)
  expect(JSON.stringify(caches)).not.toMatch(/email|@example|join_secret|invite_token|photo_path/)
})

it('keeps per-cache pending counts scoped even when one stock item is shared across caches',async()=>{
  const f=await fixture()
  const items=await cacheItems(env.DB,f.a.id,f.member)
  expect(items).toEqual([expect.objectContaining({id:f.item.id,pending_count:1,available_quantity:95})])
  const summary=await homeSummary(env.DB,f.member)
  expect(summary).toMatchObject({pending_answer_count:0,owned_item_count:0,incoming:[]})
  expect(summary.outgoing).toEqual([expect.objectContaining({user_id:f.owner,item_title:'Jars',status:'pending'})])
  expect(JSON.stringify([items,summary])).not.toContain(f.outsider)
  expect(JSON.stringify([items,summary])).not.toContain(f.b.id)
})

it('counts beyond feed page size but bounds previews; no contact/message/photo keys reach summaries',async()=>{
  const f=await fixture()
  const statements=Array.from({length:28},(_,n)=>env.DB.prepare(`INSERT INTO requests(id,item_id,cache_id,requester_id,quantity,status,created_at,creation_token) VALUES (?,?,?,?,1,'pending',?,?)`).bind(crypto.randomUUID(),f.item.id,f.a.id,f.member,n,crypto.randomUUID()))
  await env.DB.batch(statements)
  await env.DB.prepare(`INSERT INTO user_contacts(user_id,kind,value) VALUES (?,'email','chosen@example.com')`).bind(f.member).run()
  const summary=await homeSummary(env.DB,f.owner)
  expect(summary.pending_answer_count).toBe(30)
  expect(summary.owned_item_count).toBe(2)
  expect(summary.incoming).toHaveLength(2)
  expect((await listMyCaches(env.DB,f.owner)).results.find(c=>c.id===f.a.id)?.pending_answer_count).toBe(29)
  expect((await homeSummary(env.DB,f.member)).outgoing).toHaveLength(3)
  expect(JSON.stringify(summary)).not.toMatch(/email|contact|approval_message|decision_reason|photo_path/)
})

it('denies nonmembers/pending/left/removed and rechecks caller, item owner and requester for every aggregate',async()=>{
  const f=await fixture(), stranger=await user('Stranger')
  for(const status of ['pending','left','removed']) {
    await env.DB.prepare('UPDATE memberships SET status=? WHERE cache_id=? AND user_id=?').bind(status,f.a.id,f.member).run()
    expect((await listMyCaches(env.DB,f.member)).results).toEqual([])
    await expect(cacheDetail(env.DB,f.a.id,f.member)).rejects.toMatchObject({status:404})
    await expect(cacheItems(env.DB,f.a.id,f.member)).rejects.toMatchObject({status:404})
    expect((await homeSummary(env.DB,f.owner)).pending_answer_count).toBe(1)
    expect((await homeSummary(env.DB,f.member)).outgoing).toEqual([])
  }
  await expect(cacheDetail(env.DB,f.a.id,stranger)).rejects.toMatchObject({status:404})
  await removeCacheMember(env.DB,f.b.id,f.outsider,f.owner)
  expect((await homeSummary(env.DB,f.owner)).pending_answer_count).toBe(0)
  expect((await listMyCaches(env.DB,f.outsider)).results[0].attached_item_count).toBe(0)
  expect((await cacheDetail(env.DB,f.b.id,f.outsider)).members).toHaveLength(1)
})

it('serves summaries only for the authenticated caller, GET-only/no-store, and cache HTTP reads return404 after removal',async()=>{
  const caller=await login('summary@example.com')
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:caller.cookie,body:{display_name:'Caller'}}),env)
  const f=await fixture()
  const response=await worker.fetch(appRequest(`/api/me/summary?user_id=${f.owner}`,{cookie:caller.cookie}),env)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({owned_item_count:0,pending_answer_count:0,incoming:[],outgoing:[]})
  expect((await worker.fetch(appRequest('/api/me/summary'),env)).status).toBe(401)
  expect((await worker.fetch(appRequest('/api/me/summary',{method:'POST',cookie:caller.cookie,body:{}}),env)).status).toBe(405)
  for(const suffix of ['', '/items']) expect((await worker.fetch(appRequest(`/api/caches/${f.a.id}${suffix}`,{cookie:caller.cookie}),env)).status).toBe(404)
  await joinCache(env.DB,f.a.id,caller.id,f.a.invite_token.split('.')[1])
  expect((await worker.fetch(appRequest(`/api/caches/${f.a.id}`,{cookie:caller.cookie}),env)).status).toBe(200)
  await removeCacheMember(env.DB,f.a.id,f.owner,caller.id)
  expect((await worker.fetch(appRequest(`/api/caches/${f.a.id}`,{cookie:caller.cookie}),env)).status).toBe(404)
})
