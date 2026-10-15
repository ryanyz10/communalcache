import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, createScheduledController, type D1Migration } from 'cloudflare:test'
import worker from '../src/index'
import { attachItem, createCache, createItem, createRequest, decideRequest, itemDetail, itemRequests, joinCache, requestsPage, updateItem } from '../src/db'
import { itemChanges } from '../src/items'
import { decisionInput, requestQuantity } from '../src/requests'
import { deliverNotification } from '../src/notifications'
import { appRequest, login } from './helpers'

async function user(name = 'Neighbor') {
  const id = crypto.randomUUID(), now = new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?,?,?,1,?,?,?)').bind(id,'',`${id}@example.test`,now,now,name).run()
  return id
}
async function fixture(quantity = 10, reusable = false) {
  const admin = await user('Cache admin'), owner = await user('Owner'), first = await user('First requester'), second = await user('Second requester'), neighbor = await user('Neighbor')
  const a = await createCache(env.DB,admin,'Cache A',false), b = await createCache(env.DB,admin,'Cache B',false)
  for(const cache of [a,b]) await joinCache(env.DB,cache.id,owner,cache.invite_token.split('.')[1])
  for(const caller of [first,neighbor]) await joinCache(env.DB,a.id,caller,a.invite_token.split('.')[1])
  await joinCache(env.DB,b.id,second,b.invite_token.split('.')[1])
  const item = await createItem(env.DB,owner,itemChanges({title:reusable?'Mixer':'Sugar',is_consumable:!reusable,quantity:reusable?null:quantity},true),a.id)
  await attachItem(env.DB,item.id,b.id,owner)
  return {admin,owner,first,second,neighbor,a,b,item}
}
function outbox() { return env.DB.prepare('SELECT id,kind,payload FROM outbox ORDER BY created_at,id').all<{id:string;kind:string;payload:string}>() }
function reserved(id: string) { return env.DB.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM requests WHERE item_id=? AND status='pending'").bind(id).first<number>('n') }
const approve = () => decisionInput({},'approve')
const reject = () => decisionInput({reason:'Not today'},'reject')

it('adds request storage/indexes additively and retains quantity/status/decided_at/FK checks', async () => {
  const f = await fixture(), migrations = (env as unknown as {TEST_MIGRATIONS:D1Migration[]}).TEST_MIGRATIONS
  const migration = migrations.find(row=>row.name.includes('d1_requests'))!
  await env.DB.exec('DROP TABLE requests')
  await env.DB.prepare('DELETE FROM d1_migrations WHERE name=?').bind(migration.name).run()
  await applyD1Migrations(env.DB,[migration])
  expect((await itemDetail(env.DB,f.item.id,f.owner)).quantity).toBe(10)
  expect(await env.DB.prepare('SELECT status FROM memberships WHERE cache_id=? AND user_id=?').bind(f.a.id,f.first).first('status')).toBe('active')
  for(const [quantity,status,decided,reason] of [[0,'pending',null,null],[10000,'pending',null,null],[0.5,'pending',null,null],[1,'approved',null,null],[1,'rejected',1,null],[1,'invalid',1,null]] as const) {
    await expect(env.DB.prepare('INSERT INTO requests(id,item_id,cache_id,requester_id,quantity,status,decided_at,decision_reason,created_at,creation_token) VALUES (?,?,?,?,?,?,?,?,1,?)')
      .bind(crypto.randomUUID(),f.item.id,f.a.id,f.first,quantity,status,decided,reason,crypto.randomUUID()).run()).rejects.toThrow()
  }
  await expect(env.DB.prepare("INSERT INTO requests(id,item_id,cache_id,requester_id,quantity,status,created_at,creation_token) VALUES (?,?,?,?,1,'pending',1,?)")
    .bind(crypto.randomUUID(),crypto.randomUUID(),f.a.id,f.first,crypto.randomUUID()).run()).rejects.toThrow()
})

it('admits exactly one of two concurrent requests for the last unit through different caches', async () => {
  const f = await fixture(1)
  const results = await Promise.allSettled([createRequest(env.DB,f.item.id,f.a.id,f.first,1),createRequest(env.DB,f.item.id,f.b.id,f.second,1)])
  expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1)
  expect((results.find(row=>row.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({status:409,code:'insufficient_stock'})
  expect(await reserved(f.item.id)).toBe(1)
  expect(await itemDetail(env.DB,f.item.id,f.owner)).toMatchObject({quantity:1,available_quantity:0})
  expect((await outbox()).results).toHaveLength(1)
})

it('never overbooks the all-cache reservation sum under many concurrent creates', async () => {
  const f = await fixture(9)
  const results = await Promise.allSettled(Array.from({length:20},(_,index)=>createRequest(env.DB,f.item.id,index%2?f.a.id:f.b.id,index%2?f.first:f.second,2)))
  expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(4)
  expect(await reserved(f.item.id)).toBe(8)
  expect((await outbox()).results).toHaveLength(4)
  for(const cache of [f.a,f.b])expect(await itemDetail(env.DB,f.item.id,f.owner,cache.id)).toMatchObject({quantity:9,available_quantity:1})
})

it('deducts stock and emits a decision notification only once under concurrent double approval', async () => {
  const f = await fixture(), request = await createRequest(env.DB,f.item.id,f.a.id,f.first,3)
  await createRequest(env.DB,f.item.id,f.b.id,f.second,2)
  const decisions = await Promise.allSettled(Array.from({length:12},()=>decideRequest(env.DB,request.request.id,f.owner,'approve',approve())))
  expect(decisions.filter(row=>row.status==='fulfilled')).toHaveLength(1)
  expect(decisions.filter(row=>row.status==='rejected').every(row=>row.reason.status===409 && row.reason.code==='request_not_pending')).toBe(true)
  expect(await itemDetail(env.DB,f.item.id,f.owner)).toMatchObject({quantity:7,available_quantity:5})
  const before = (await outbox()).results
  expect(before.filter(row=>row.kind==='request_approved')).toHaveLength(1)
  await expect(decideRequest(env.DB,request.request.id,f.owner,'reject',reject())).rejects.toMatchObject({status:409})
  expect((await outbox()).results).toEqual(before)
})

it('approve versus reject has one winner with stock, reservation and outbox reflecting only that decision', async () => {
  const f = await fixture(5), request = await createRequest(env.DB,f.item.id,f.a.id,f.first,5)
  const results = await Promise.allSettled([decideRequest(env.DB,request.request.id,f.owner,'approve',approve()),decideRequest(env.DB,request.request.id,f.owner,'reject',reject())])
  expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1)
  const won = (results.find(row=>row.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof decideRequest>>>).value.request
  expect((await itemDetail(env.DB,f.item.id,f.owner)).quantity).toBe(won.status==='approved'?0:5)
  expect(await reserved(f.item.id)).toBe(0)
  expect((await outbox()).results.filter(row=>row.kind!=='request_created')).toHaveLength(1)
})

it('guards stock edits against pending across every cache and serializes stock-edit/create races', async () => {
  const f = await fixture(5), first = await createRequest(env.DB,f.item.id,f.a.id,f.first,3)
  await createRequest(env.DB,f.item.id,f.b.id,f.second,2)
  await expect(updateItem(env.DB,f.item.id,f.owner,itemChanges({title:'Lost edit',quantity:4},false))).rejects.toMatchObject({status:409,code:'quantity_reserved'})
  expect(await itemDetail(env.DB,f.item.id,f.owner)).toMatchObject({title:'Sugar',quantity:5})
  await updateItem(env.DB,f.item.id,f.owner,itemChanges({quantity:8},false))
  const results = await Promise.allSettled([createRequest(env.DB,f.item.id,f.a.id,f.first,3),updateItem(env.DB,f.item.id,f.owner,itemChanges({quantity:5},false))])
  expect(results.filter(row=>row.status==='rejected')).toHaveLength(1)
  const item = await itemDetail(env.DB,f.item.id,f.owner)
  expect(item.quantity!).toBeGreaterThanOrEqual((await reserved(f.item.id))!)
  await decideRequest(env.DB,first.request.id,f.owner,'reject',reject())
  const floor = (await reserved(f.item.id))!
  expect((await updateItem(env.DB,f.item.id,f.owner,itemChanges({quantity:floor},false))).quantity).toBe(floor)
})

it('Lent out blocks new requests, preserves pending rows and unchecked approvals never clear the flag or note', async () => {
  const f = await fixture(0,true), first = await createRequest(env.DB,f.item.id,f.a.id,f.first,null), second = await createRequest(env.DB,f.item.id,f.b.id,f.second,null)
  await updateItem(env.DB,f.item.id,f.owner,itemChanges({available:false,unavailable_note:'Back next week'},false))
  await expect(createRequest(env.DB,f.item.id,f.a.id,f.neighbor,null)).rejects.toMatchObject({status:409,code:'item_unavailable'})
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE status='pending'").first('n')).toBe(2)
  await decideRequest(env.DB,first.request.id,f.owner,'approve',approve())
  expect(await itemDetail(env.DB,f.item.id,f.owner)).toMatchObject({available:false,unavailable_note:'Back next week',quantity:null})
  await decideRequest(env.DB,second.request.id,f.owner,'approve',decisionInput({mark_lent_out:true,unavailable_note:'😀'.repeat(200)},'approve'))
  for(const cache of [f.a,f.b])expect(await itemDetail(env.DB,f.item.id,f.owner,cache.id)).toMatchObject({available:false,unavailable_note:'😀'.repeat(200)})
  await updateItem(env.DB,f.item.id,f.owner,itemChanges({available:true,unavailable_note:null},false))
  expect((await createRequest(env.DB,f.item.id,f.a.id,f.neighbor,null)).request.status).toBe('pending')
  expect(()=>decisionInput({mark_lent_out:true,unavailable_note:'😀'.repeat(201)},'approve')).toThrow('invalid_unavailable_note')
})

it('serializes a Lent out approval against new asks while preserving any request that committed first', async () => {
  for(const approveFirst of [false,true]) {
    const f = await fixture(0,true), pending = await createRequest(env.DB,f.item.id,f.a.id,f.first,null)
    const decide = ()=>decideRequest(env.DB,pending.request.id,f.owner,'approve',decisionInput({mark_lent_out:true},'approve'))
    const ask = ()=>createRequest(env.DB,f.item.id,f.b.id,f.second,null)
    const results = await Promise.allSettled(approveFirst?[decide(),ask()]:[ask(),decide()])
    expect(results[approveFirst?0:1].status).toBe('fulfilled')
    expect((await itemDetail(env.DB,f.item.id,f.owner)).available).toBe(false)
    const requested = results[approveFirst?1:0]
    if(requested.status==='fulfilled')expect(await env.DB.prepare('SELECT status FROM requests WHERE id=?').bind(requested.value.request.id).first('status')).toBe('pending')
    else expect(requested.reason).toMatchObject({status:409,code:'item_unavailable'})
  }
})

it('the reusable approval checkbox sets flag/note atomically and cannot be applied to consumables', async () => {
  const tool = await fixture(0,true), request = await createRequest(env.DB,tool.item.id,tool.a.id,tool.first,null)
  await decideRequest(env.DB,request.request.id,tool.owner,'approve',decisionInput({mark_lent_out:true,unavailable_note:'With a neighbor'},'approve'))
  expect(await itemDetail(env.DB,tool.item.id,tool.owner)).toMatchObject({available:false,unavailable_note:'With a neighbor'})
  const stock = await fixture(), consumable = await createRequest(env.DB,stock.item.id,stock.a.id,stock.first,1), before = (await outbox()).results.length
  await expect(decideRequest(env.DB,consumable.request.id,stock.owner,'approve',decisionInput({mark_lent_out:true},'approve'))).rejects.toMatchObject({status:400,code:'invalid_lent_out'})
  expect((await outbox()).results).toHaveLength(before)
  expect((await itemDetail(env.DB,stock.item.id,stock.owner)).quantity).toBe(10)
})

it('requires active requester/owner membership, attachment, non-owner and type-valid quantities in the INSERT', async () => {
  const f = await fixture()
  await expect(createRequest(env.DB,f.item.id,f.a.id,f.owner,1)).rejects.toMatchObject({status:404})
  await expect(createRequest(env.DB,f.item.id,f.b.id,f.first,1)).rejects.toMatchObject({status:404})
  await expect(createRequest(env.DB,f.item.id,f.a.id,f.first,null)).rejects.toMatchObject({status:400})
  for(const quantity of [0,-1,10000,0.5,'1',true])expect(()=>requestQuantity({quantity})).toThrow('invalid_request_quantity')
  for(const field of ['owner_id','requester_id'])expect(()=>requestQuantity({quantity:1,[field]:f.owner})).toThrow('not_found')
  for(const status of ['pending','removed']) {
    await env.DB.prepare('UPDATE memberships SET status=? WHERE cache_id=? AND user_id=?').bind(status,f.a.id,f.first).run()
    await expect(createRequest(env.DB,f.item.id,f.a.id,f.first,1)).rejects.toMatchObject({status:404})
  }
  await env.DB.prepare("UPDATE memberships SET status='removed' WHERE cache_id=? AND user_id=?").bind(f.b.id,f.owner).run()
  await expect(createRequest(env.DB,f.item.id,f.b.id,f.second,1)).rejects.toMatchObject({status:404})
  expect((await outbox()).results).toEqual([])
})

it('refuses removed requesters in request/removal races without exposing destructive routes early', async () => {
  for(const removeFirst of [false,true]) {
    const f = await fixture(1)
    const remove = ()=>env.DB.prepare("UPDATE memberships SET status='removed' WHERE cache_id=? AND user_id=?").bind(f.a.id,f.first).run()
    const ask = ()=>createRequest(env.DB,f.item.id,f.a.id,f.first,1)
    const results = await Promise.allSettled(removeFirst?[remove(),ask()]:[ask(),remove()])
    expect(results[removeFirst?0:1].status).toBe('fulfilled')
    const before = (await outbox()).results
    await expect(ask()).rejects.toMatchObject({status:404})
    expect((await outbox()).results).toEqual(before)
    await expect(itemRequests(env.DB,f.item.id,f.a.id,f.first)).rejects.toMatchObject({status:404})
    const created = results[removeFirst?1:0]
    if(created.status==='fulfilled')await expect(decideRequest(env.DB,(created.value as Awaited<ReturnType<typeof createRequest>>).request.id,f.owner,'approve',approve())).rejects.toMatchObject({status:404})
  }
})

it('cache queues reveal only their own pending requesters; decided/history rows remain party-scoped', async () => {
  const f = await fixture(), first = await createRequest(env.DB,f.item.id,f.a.id,f.first,2), second = await createRequest(env.DB,f.item.id,f.b.id,f.second,3)
  expect((await itemRequests(env.DB,f.item.id,f.a.id,f.neighbor)).map(row=>row.id)).toEqual([first.request.id])
  expect((await itemDetail(env.DB,f.item.id,f.neighbor,f.a.id)).available_quantity).toBe(5)
  await expect(decideRequest(env.DB,first.request.id,f.admin,'approve',approve())).rejects.toMatchObject({status:404})
  await expect(decideRequest(env.DB,second.request.id,f.owner,'approve',approve(),f.a.id)).rejects.toMatchObject({status:404})
  await decideRequest(env.DB,first.request.id,f.owner,'reject',reject())
  expect(await itemRequests(env.DB,f.item.id,f.a.id,f.neighbor)).toEqual([])
  expect((await itemRequests(env.DB,f.item.id,f.a.id,f.first)).map(row=>row.id)).toEqual([first.request.id])
  expect((await requestsPage(env.DB,f.neighbor,null)).requests).toEqual([])
  expect((await requestsPage(env.DB,f.owner,null)).requests).toHaveLength(2)
  await env.DB.prepare("UPDATE memberships SET status='removed' WHERE cache_id=? AND user_id=?").bind(f.a.id,f.first).run()
  const history = await requestsPage(env.DB,f.first,null)
  expect(history.requests.map(row=>row.id)).toEqual([first.request.id])
  for(const hidden of ['example.test','decision_token','creation_token'])expect(JSON.stringify(history)).not.toContain(hidden)
  await expect(itemDetail(env.DB,f.item.id,f.first,f.a.id)).rejects.toMatchObject({status:404})
})

it('party history is not decision authority after owner membership or attachment loss', async () => {
  const f = await fixture(), request = await createRequest(env.DB,f.item.id,f.a.id,f.first,2), before = (await outbox()).results
  await env.DB.prepare("UPDATE memberships SET status='removed' WHERE cache_id=? AND user_id=?").bind(f.a.id,f.owner).run()
  expect((await requestsPage(env.DB,f.owner,null)).requests).toHaveLength(1)
  await expect(decideRequest(env.DB,request.request.id,f.owner,'approve',approve())).rejects.toMatchObject({status:404})
  await env.DB.prepare("UPDATE memberships SET status='active' WHERE cache_id=? AND user_id=?").bind(f.a.id,f.owner).run()
  await env.DB.prepare('DELETE FROM item_caches WHERE item_id=? AND cache_id=?').bind(f.item.id,f.a.id).run()
  await expect(decideRequest(env.DB,request.request.id,f.owner,'reject',reject())).rejects.toMatchObject({status:404})
  expect((await outbox()).results).toEqual(before)
  expect((await itemDetail(env.DB,f.item.id,f.owner)).quantity).toBe(10)
})

it('validates rejection/checkbox/note inputs with Unicode bounds and no forged decision party', () => {
  for(const reason of [null,'','  ',123,'😀'.repeat(501)])expect(()=>decisionInput({reason},'reject')).toThrow('invalid_reason')
  expect(decisionInput({reason:'😀'.repeat(500)},'reject').reason).toHaveLength(1000)
  expect(()=>decisionInput({mark_lent_out:'yes'},'approve')).toThrow('invalid_lent_out')
  expect(()=>decisionInput({mark_lent_out:true,reason:'Not today'},'reject')).toThrow('invalid_lent_out')
  expect(()=>decisionInput({owner_id:'forged'},'approve')).toThrow('not_found')
  expect(decisionInput({mark_lent_out:true,unavailable_note:'  '},'approve').unavailable_note).toBeNull()
})

it('rolls request state, stock, optional availability and outbox back on injected SQL failures', async () => {
  const f = await fixture(), tool = await fixture(0,true)
  await env.DB.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'injected outbox failure'); END")
  await expect(createRequest(env.DB,f.item.id,f.a.id,f.first,1)).rejects.toThrow('injected outbox failure')
  expect(await reserved(f.item.id)).toBe(0)
  await env.DB.exec('DROP TRIGGER fail_outbox')
  const request = await createRequest(env.DB,f.item.id,f.a.id,f.first,3), reusable = await createRequest(env.DB,tool.item.id,tool.a.id,tool.first,null)
  const before = (await outbox()).results
  await env.DB.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'injected outbox failure'); END")
  await expect(decideRequest(env.DB,request.request.id,f.owner,'approve',approve())).rejects.toThrow('injected outbox failure')
  await expect(decideRequest(env.DB,reusable.request.id,tool.owner,'approve',decisionInput({mark_lent_out:true,unavailable_note:'Lost note'},'approve'))).rejects.toThrow('injected outbox failure')
  expect(await itemDetail(env.DB,f.item.id,f.owner)).toMatchObject({quantity:10,available_quantity:7})
  expect(await itemDetail(env.DB,tool.item.id,tool.owner)).toMatchObject({available:true,unavailable_note:null})
  expect((await outbox()).results).toEqual(before)
  await env.DB.exec('DROP TRIGGER fail_outbox')
  await env.DB.exec("CREATE TRIGGER corrupt_stock AFTER UPDATE ON requests WHEN NEW.status='approved' AND NEW.quantity IS NOT NULL BEGIN UPDATE items SET quantity=0 WHERE id=NEW.item_id; END")
  await expect(decideRequest(env.DB,request.request.id,f.owner,'approve',approve())).rejects.toThrow()
  expect((await itemDetail(env.DB,f.item.id,f.owner)).quantity).toBe(10)
  expect(await env.DB.prepare('SELECT status FROM requests WHERE id=?').bind(request.request.id).first('status')).toBe('pending')
  expect((await outbox()).results).toEqual(before)
})

it('a zero-row create cannot reuse a previous request ID to manufacture an outbox row', async () => {
  const f = await fixture(1), request = await createRequest(env.DB,f.item.id,f.a.id,f.first,1), before = (await outbox()).results
  const random = crypto.randomUUID.bind(crypto)
  vi.spyOn(crypto,'randomUUID').mockReturnValueOnce(request.request.id as `${string}-${string}-${string}-${string}-${string}`).mockImplementation(()=>random())
  await expect(createRequest(env.DB,f.item.id,f.b.id,f.second,1)).rejects.toMatchObject({status:409})
  expect((await outbox()).results).toEqual(before)
})

it('pages direct incoming/outgoing party queries with stable timestamp/UUID cursors and no cache fan-out', async () => {
  const f = await fixture(100), ids: string[] = []
  for(let index=0;index<27;index++)ids.push((await createRequest(env.DB,f.item.id,f.a.id,f.first,1)).request.id)
  await env.DB.prepare('UPDATE requests SET created_at=1').run()
  const first = await requestsPage(env.DB,f.first,null), second = await requestsPage(env.DB,f.first,first.next_cursor)
  expect(first.requests).toHaveLength(25)
  expect(second.requests).toHaveLength(2)
  expect(second.next_cursor).toBeNull()
  expect([...first.requests,...second.requests].map(row=>row.id)).toEqual(ids.sort().reverse())
  expect((await requestsPage(env.DB,f.owner,null)).requests).toHaveLength(25)
  for(const bad of ['bad','-1.'+ids[0],'9999999999999999.'+ids[0],'1.bad'])await expect(requestsPage(env.DB,f.first,bad)).rejects.toMatchObject({status:400})
})

it('reopens Worker requests with auth/CSRF/limits, atomic notifications, and post-commit enqueue recovery', async () => {
  const owner = await login('owner@example.test'), caller = await login('requester@example.test')
  for(const user of [owner,caller])await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:user.cookie,body:{display_name:'Neighbor'}}),env)
  const cache = await createCache(env.DB,owner.id,'Tools',false)
  await joinCache(env.DB,cache.id,caller.id,cache.invite_token.split('.')[1])
  const item = await createItem(env.DB,owner.id,itemChanges({title:'Sugar',is_consumable:true,quantity:2},true),cache.id), path = `/api/caches/${cache.id}/items/${item.id}/requests`
  expect((await worker.fetch(appRequest(path,{method:'POST',body:{quantity:1}}),env)).status).toBe(401)
  for(const origin of [null,'null','https://foreign.test'])expect((await worker.fetch(appRequest(path,{method:'POST',cookie:caller.cookie,origin,body:{quantity:1}}),env)).status).toBe(403)
  const send = vi.spyOn(env.NOTIFICATIONS,'send').mockRejectedValue(new Error('injected enqueue failure'))
  const response = await worker.fetch(appRequest(path,{method:'POST',cookie:caller.cookie,body:{quantity:1}}),env)
  expect(response.status).toBe(201)
  const created = await response.json() as {id:string}
  send.mockRestore()
  const event = (await outbox()).results[0]
  await env.DB.prepare('UPDATE outbox SET created_at=?').bind(Date.now()-240000).run()
  const rescue = vi.spyOn(env.NOTIFICATIONS,'sendBatch')
  await worker.scheduled(createScheduledController(),env)
  expect(rescue).toHaveBeenCalledWith([{body:event.id}])
  const decision = await worker.fetch(appRequest(`/api/me/requests/${created.id}/approve`,{method:'POST',cookie:owner.cookie,body:{}}),env)
  expect(decision.status).toBe(200)
  expect((await worker.fetch(appRequest(`/api/caches/${cache.id}/requests/${created.id}/reject`,{method:'POST',cookie:owner.cookie,body:{reason:'Too late'}}),env)).status).toBe(409)
  for(const route of [path,'/api/requests']) {
    const result = await worker.fetch(appRequest(route,{cookie:caller.cookie}),env)
    expect(result.status).toBe(200)
    expect(JSON.stringify(await result.json())).not.toContain('example.test')
  }
  const mail = vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({id:'notification'}));mail.mockClear()
  expect(await deliverNotification(env,event.id)).toBe('ack')
  expect(JSON.parse(mail.mock.calls[0][1]!.body as string).to).toEqual(['owner@example.test'])
  const approved = (await outbox()).results.find(row=>row.kind==='request_approved')!
  expect(await deliverNotification(env,approved.id)).toBe('ack')
  expect(JSON.parse(mail.mock.calls[1][1]!.body as string).to).toEqual(['requester@example.test'])
  const window = Math.floor(Date.now()/60000)*60000
  await env.DB.prepare("UPDATE write_limits SET count=20,window_start=? WHERE user_id=? AND route='request'").bind(window,caller.id).run()
  expect((await worker.fetch(appRequest(path,{method:'POST',cookie:caller.cookie,body:{quantity:1}}),env)).status).toBe(429)
  expect((await worker.fetch(appRequest(`/api/caches/${cache.id}/members/${caller.id}`,{method:'DELETE',cookie:owner.cookie}),env)).status).toBe(503)
})
