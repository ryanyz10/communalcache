import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import worker from '../src/index'
import { attachItem, cacheDetail, cacheItems, createCache, createItem, createRequest, decideRequest, homeSummary, itemDetail, itemRequests, joinCache, libraryItems, libraryPage, listMyCaches, requestDetail, updateItem } from '../src/db'
import { itemChanges } from '../src/items'
import { decisionInput } from '../src/requests'
import { serveItemPhoto } from '../src/photos'
import { appRequest, login } from './helpers'

async function user() {
  const id=crypto.randomUUID(), now=new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?,?,?,1,?,?,?)').bind(id,'',`${id}@example.test`,now,now,'Neighbor').run()
  return id
}
async function fixture() {
  const owner=await user(), member=await user(), other=await user()
  await env.DB.prepare("UPDATE user SET plan='plus' WHERE id=?").bind(owner).run()
  const first=await createCache(env.DB,owner,'Tools',false), second=await createCache(env.DB,owner,'Garden',false)
  for (const cache of [first,second]) await joinCache(env.DB,cache.id,member,cache.invite_token.split('.')[1])
  const item=await createItem(env.DB,owner,itemChanges({title:'Sugar',is_consumable:true,quantity:10},true),first.id)
  await attachItem(env.DB,item.id,second.id,owner)
  const a=await createRequest(env.DB,item.id,first.id,member,2), b=await createRequest(env.DB,item.id,second.id,member,3)
  return {owner,member,other,first,second,item,a,b}
}
const rejected = () => env.DB.prepare("SELECT id,payload,dedupe_key FROM outbox WHERE kind='request_rejected' ORDER BY id").all<{id:string;payload:string;dedupe_key:string}>()

it('adds the active boolean forward-only with existing rows active and constraints intact', async () => {
  const f=await fixture(), migrations=(env as unknown as {TEST_MIGRATIONS:D1Migration[]}).TEST_MIGRATIONS
  const migration=migrations.find(row=>row.name.includes('0020_item_active'))!
  await env.DB.exec('ALTER TABLE items DROP COLUMN active')
  await env.DB.prepare('DELETE FROM d1_migrations WHERE name=?').bind(migration.name).run()
  await applyD1Migrations(env.DB,[migration])
  expect(await itemDetail(env.DB,f.item.id,f.owner)).toMatchObject({active:true,quantity:10,title:'Sugar',pending_count:2})
  for (const active of [null,2,-1]) await expect(env.DB.prepare('UPDATE items SET active=? WHERE id=?').bind(active,f.item.id).run()).rejects.toThrow()
  for (const active of [null,0,'false']) expect(()=>itemChanges({active},false)).toThrow('invalid_active')
})

it('atomically deactivates, edits fields, snapshots every cache requester and rejects pending without stock deduction or detach', async () => {
  const f=await fixture()
  await updateItem(env.DB,f.item.id,f.owner,{available:false})
  const saved=await updateItem(env.DB,f.item.id,f.owner,{active:false,title:'Brown sugar',quantity:0},f.first.id)
  expect(saved).toMatchObject({active:false,available:false,title:'Brown sugar',quantity:0,pending_count:0,cache_id:null})
  expect(saved.notificationIds.sort()).toEqual([f.a.request.id,f.b.request.id].sort())
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM item_caches WHERE item_id=?').bind(f.item.id).first('n')).toBe(2)
  const rows=(await rejected()).results
  expect(rows).toHaveLength(2)
  for (const row of rows) {
    expect(JSON.parse(row.payload)).toMatchObject({event:'request_rejected',item_detached:true,item_title:'Brown sugar',recipient_id:f.member,reason:'item no longer shared in this cache'})
    expect(row.dedupe_key).toContain(`:${row.id}`)
    expect(await requestDetail(env.DB,row.id,f.member)).toMatchObject({status:'rejected',decision_reason:'item no longer shared in this cache'})
  }
})

it('a zero-row owner/state guard leaves all dependent rejection/outbox writes untouched', async () => {
  const f=await fixture()
  await expect(updateItem(env.DB,f.item.id,f.other,{active:false})).rejects.toMatchObject({status:404})
  expect((await rejected()).results).toEqual([])
  expect((await libraryItems(env.DB,f.owner))[0].pending_count).toBe(2)
  // A stale first write must not gain a witness merely because the row is already inactive.
  await env.DB.prepare('UPDATE items SET active=0 WHERE id=?').bind(f.item.id).run()
  await expect(updateItem(env.DB,f.item.id,f.owner,{active:false})).rejects.toMatchObject({status:409,code:'item_state_changed'})
  expect((await rejected()).results).toEqual([])
  expect((await libraryItems(env.DB,f.owner))[0].pending_count).toBe(2)
  expect(await homeSummary(env.DB,f.owner)).toMatchObject({pending_answer_count:0,incoming:[]})
  expect((await homeSummary(env.DB,f.member)).outgoing).toEqual([])
  await expect(decideRequest(env.DB,f.a.request.id,f.owner,'approve',decisionInput({},'approve'))).rejects.toMatchObject({status:404})
})

it('serializes deactivation against a new ask or approval without leaving a pending row or deducting twice', async () => {
  for (const action of ['ask','approve']) {
    const f=await fixture()
    await Promise.allSettled([
      action==='ask' ? createRequest(env.DB,f.item.id,f.first.id,f.member,1)
        : decideRequest(env.DB,f.a.request.id,f.owner,'approve',decisionInput({},'approve')),
      updateItem(env.DB,f.item.id,f.owner,{active:false}),
    ])
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE item_id=? AND status='pending'").bind(f.item.id).first('n')).toBe(0)
    const approved=await env.DB.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM requests WHERE item_id=? AND status='approved'").bind(f.item.id).first<number>('n')
    expect(await itemDetail(env.DB,f.item.id,f.owner)).toMatchObject({active:false,quantity:10-approved!})
  }
})

for (const failure of ['outbox','requests']) it(`rolls deactivation, field edits and every durable effect back on ${failure} failure`, async () => {
  const f=await fixture()
  await env.DB.exec(failure==='outbox'
    ? "CREATE TRIGGER fail_deactivation BEFORE INSERT ON outbox WHEN NEW.kind='request_rejected' BEGIN SELECT RAISE(ABORT,'injected deactivation failure'); END"
    : "CREATE TRIGGER fail_deactivation BEFORE UPDATE ON requests WHEN NEW.status='rejected' BEGIN SELECT RAISE(ABORT,'injected deactivation failure'); END")
  await expect(updateItem(env.DB,f.item.id,f.owner,{active:false,title:'Lost edit',quantity:0})).rejects.toThrow('injected deactivation failure')
  expect(await itemDetail(env.DB,f.item.id,f.owner)).toMatchObject({active:true,title:'Sugar',quantity:10,pending_count:2})
  expect((await rejected()).results).toEqual([])
})

it('hides inactive items from cache lists/detail/photos/queues/asks/counts/Home while retaining private library and history', async () => {
  const f=await fixture(), key=`${f.owner}/${f.item.id}/${crypto.randomUUID()}`
  await env.BUCKET.put(key,'private photo',{httpMetadata:{contentType:'image/jpeg'}})
  await env.DB.prepare('UPDATE items SET photo_path=? WHERE id=?').bind(key,f.item.id).run()
  const photoRequest=new Request('https://example.test/photo')
  expect((await serveItemPhoto(photoRequest,env,f.item.id,f.member,f.first.id)).status).toBe(200)
  await decideRequest(env.DB,f.a.request.id,f.owner,'approve',decisionInput({},'approve'))
  await updateItem(env.DB,f.item.id,f.owner,{active:false})
  for (const cache of [f.first,f.second]) {
    for (const caller of [f.member,f.owner]) {
      expect(await cacheItems(env.DB,cache.id,caller)).toEqual([])
      await expect(itemDetail(env.DB,f.item.id,caller,cache.id)).rejects.toMatchObject({status:404})
      await expect(itemRequests(env.DB,f.item.id,cache.id,caller)).rejects.toMatchObject({status:404})
      await expect(serveItemPhoto(photoRequest,env,f.item.id,caller,cache.id)).rejects.toMatchObject({status:404})
    }
    await expect(createRequest(env.DB,f.item.id,cache.id,f.member,1)).rejects.toMatchObject({status:404,code:'not_found'})
    expect((await cacheDetail(env.DB,cache.id,f.member)).members.find(row=>row.user_id===f.owner)?.attached_item_count).toBe(0)
  }
  expect((await listMyCaches(env.DB,f.member)).results.every(row=>row.attached_item_count===0)).toBe(true)
  expect(await homeSummary(env.DB,f.owner)).toMatchObject({owned_item_count:1,pending_answer_count:0,incoming:[]})
  expect((await homeSummary(env.DB,f.member)).outgoing).toEqual([])
  expect((await libraryItems(env.DB,f.owner))[0]).toMatchObject({id:f.item.id,active:false})
  expect((await libraryPage(env.DB,f.owner,null)).items[0]).toMatchObject({active:false})
  expect((await serveItemPhoto(photoRequest,env,f.item.id,f.owner)).status).toBe(200)
  expect(await requestDetail(env.DB,f.a.request.id,f.member)).toMatchObject({status:'approved'})
  expect(await requestDetail(env.DB,f.b.request.id,f.member)).toMatchObject({status:'rejected'})
  await expect(updateItem(env.DB,f.item.id,f.owner,{active:true},f.first.id)).rejects.toMatchObject({status:404})
  await updateItem(env.DB,f.item.id,f.owner,{title:'Still editable'})
  await updateItem(env.DB,f.item.id,f.owner,{active:true})
  expect((await itemDetail(env.DB,f.item.id,f.member,f.first.id)).active).toBe(true)
  expect((await cacheItems(env.DB,f.second.id,f.member))).toHaveLength(1)
  expect((await serveItemPhoto(photoRequest,env,f.item.id,f.member,f.first.id)).status).toBe(200)
  expect((await createRequest(env.DB,f.item.id,f.second.id,f.member,1)).request.status).toBe('pending')
})

it('allows attaching inactive items without making them visible or recreating declined requests', async () => {
  const f=await fixture()
  await updateItem(env.DB,f.item.id,f.owner,{active:false})
  const third=await createCache(env.DB,await user(),'Other cache',false)
  await joinCache(env.DB,third.id,f.owner,third.invite_token.split('.')[1])
  await attachItem(env.DB,f.item.id,third.id,f.owner)
  expect(await cacheItems(env.DB,third.id,f.owner)).toEqual([])
  expect((await libraryItems(env.DB,f.owner))[0].caches).toHaveLength(3)
  expect(await createItem(env.DB,f.owner,{title:'Private tent',is_consumable:false,active:false},third.id)).toMatchObject({active:false,cache_id:null})
  expect(await cacheItems(env.DB,third.id,f.owner)).toEqual([])
  await updateItem(env.DB,f.item.id,f.owner,{active:true})
  expect(await cacheItems(env.DB,third.id,f.owner)).toHaveLength(1)
  expect((await libraryItems(env.DB,f.owner))[0].pending_count).toBe(0)
})

it('the Worker enqueues deactivation hints after commit without exposing them in the item response', async () => {
  const owner=await login(), member=await user()
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:owner.cookie,body:{display_name:'Owner'}}),env)
  const cache=await createCache(env.DB,owner.id,'Tools',false)
  await joinCache(env.DB,cache.id,member,cache.invite_token.split('.')[1])
  const item=await createItem(env.DB,owner.id,{title:'Tent',is_consumable:false},cache.id)
  await createRequest(env.DB,item.id,cache.id,member,null)
  const sendBatch=env.NOTIFICATIONS.sendBatch.bind(env.NOTIFICATIONS)
  const enqueue=vi.spyOn(env.NOTIFICATIONS,'sendBatch').mockImplementation(async (messages,options) => {
    expect((await itemDetail(env.DB,item.id,owner.id)).active).toBe(false)
    return sendBatch(messages,options)
  })
  const response=await worker.fetch(appRequest(`/api/caches/${cache.id}/items/${item.id}`,{method:'PATCH',cookie:owner.cookie,body:{active:false}}),env)
  expect(response.status).toBe(200)
  const payload=await response.json()
  expect(payload).toMatchObject({active:false,cache_id:null})
  expect(payload).not.toHaveProperty('notificationIds')
  expect(enqueue).toHaveBeenCalledOnce()
  expect(JSON.stringify(await itemDetail(env.DB,item.id,owner.id))).not.toContain('notificationIds')
})
