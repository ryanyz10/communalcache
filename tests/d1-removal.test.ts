import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import worker from '../src/index'
import { attachItem, cacheDetail, cacheItems, createCache, createItem, createRequest, decideCacheJoin, decideRequest, deleteItem, detachItem, finishItemPhoto, itemDetail, joinCache, libraryItems, removeCacheMember, requestsPage, updateCache } from '../src/db'
import { itemChanges } from '../src/items'
import { decisionInput } from '../src/requests'
import { sweepPhotoCleanup } from '../src/cleanup'
import { deliverNotification, notificationContent, sweepNotifications } from '../src/notifications'
import { appRequest, base, login } from './helpers'

async function user(name = 'Neighbor') {
  const id = crypto.randomUUID(), now = new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?,?,?,1,?,?,?)').bind(id,'',`${id}@example.test`,now,now,name).run()
  return id
}
async function fixture() {
  const owner = await user('Cache owner'), member = await user('Member'), neighbor = await user('Neighbor'), outsider = await user('Outsider')
  const a = await createCache(env.DB,owner,'Cache A',false), b = await createCache(env.DB,owner,'Cache B',false)
  for(const cache of [a,b])for(const id of [member,neighbor])await joinCache(env.DB,cache.id,id,cache.invite_token.split('.')[1])
  const owned = await createItem(env.DB,member,itemChanges({title:'Member sugar',is_consumable:true,quantity:10},true),a.id)
  const other = await createItem(env.DB,owner,itemChanges({title:'Owner sugar',is_consumable:true,quantity:10},true),a.id)
  for(const item of [owned,other])await attachItem(env.DB,item.id,b.id,item.owner_id)
  return {owner,member,neighbor,outsider,a,b,owned,other}
}
async function photo(itemId: string, ownerId: string) {
  const key = `${ownerId}/${itemId}/${crypto.randomUUID()}`
  await env.BUCKET.put(key,new Uint8Array([137,80,78,71,13,10,26,10]),{httpMetadata:{contentType:'image/png'}})
  expect(await finishItemPhoto(env.DB,itemId,ownerId,key,true)).toBe(true)
  return key
}
function row(id: string) { return env.DB.prepare('SELECT status,decision_reason,decided_at,decision_token FROM requests WHERE id=?').bind(id).first<{status:string;decision_reason:string|null;decided_at:number|null;decision_token:string|null}>() }
function outbox() { return env.DB.prepare('SELECT id,kind,payload,dedupe_key FROM outbox ORDER BY id').all<{id:string;kind:string;payload:string;dedupe_key:string}>() }
function membership(cache: string, user: string) { return env.DB.prepare('SELECT role,status,created_at,operation_token FROM memberships WHERE cache_id=? AND user_id=?').bind(cache,user).first<{role:string;status:string;created_at:number;operation_token:string|null}>() }
async function affectedPending(cache: string, member: string) {
  return env.DB.prepare("SELECT COUNT(*) AS n FROM requests r JOIN items i ON i.id=r.item_id WHERE r.cache_id=? AND r.status='pending' AND (r.requester_id=? OR i.owner_id=?)").bind(cache,member,member).first<number>('n')
}

it('rebuilds the membership CHECK without losing rows, tokens, owner uniqueness or foreign keys', async () => {
  const f = await fixture(), pending = await user(), removed = await user()
  await env.DB.prepare("INSERT INTO memberships VALUES (?,?,'member','pending',123,'pending-token'),(?,?,'member','removed',456,'removed-token')").bind(f.a.id,pending,f.a.id,removed).run()
  const before = (await env.DB.prepare('SELECT * FROM memberships ORDER BY cache_id,user_id').all()).results
  const migrations = (env as unknown as {TEST_MIGRATIONS:D1Migration[]}).TEST_MIGRATIONS, migration = migrations.find(entry=>entry.name.includes('membership_leave'))!
  await env.DB.prepare('DELETE FROM d1_migrations WHERE name=?').bind(migration.name).run()
  await applyD1Migrations(env.DB,[migration])
  expect((await env.DB.prepare('SELECT * FROM memberships ORDER BY cache_id,user_id').all()).results).toEqual(before)
  await env.DB.prepare("UPDATE memberships SET status='left' WHERE cache_id=? AND user_id=?").bind(f.a.id,f.member).run()
  await expect(env.DB.prepare("UPDATE memberships SET status='left' WHERE cache_id=? AND user_id=?").bind(f.a.id,f.owner).run()).rejects.toThrow()
  await expect(env.DB.prepare("INSERT INTO memberships VALUES (?,?,'owner','active',1,NULL)").bind(f.a.id,f.outsider).run()).rejects.toThrow()
  await expect(env.DB.prepare("INSERT INTO memberships VALUES (?,?,'member','active',1,NULL)").bind(f.a.id,'missing').run()).rejects.toThrow()
})

it('removes both pending request directions in C, detaches only C and preserves library/photos/other caches', async () => {
  const f = await fixture(), key = await photo(f.owned.id,f.member)
  const incoming = await createRequest(env.DB,f.owned.id,f.a.id,f.neighbor,2), elsewhere = await createRequest(env.DB,f.owned.id,f.b.id,f.neighbor,3)
  const outgoing = await createRequest(env.DB,f.other.id,f.a.id,f.member,4), outgoingB = await createRequest(env.DB,f.other.id,f.b.id,f.member,1)
  const approved = await createRequest(env.DB,f.owned.id,f.a.id,f.owner,1)
  await decideRequest(env.DB,approved.request.id,f.member,'approve',decisionInput({},'approve'))
  const unrelated = await createRequest(env.DB,f.other.id,f.a.id,f.neighbor,2)
  const ids = await removeCacheMember(env.DB,f.a.id,f.owner,f.member)
  expect(ids.sort()).toEqual([incoming.request.id,outgoing.request.id].sort())
  const member = await membership(f.a.id,f.member)
  expect(member?.status).toBe('removed')
  for(const request of [incoming,outgoing])expect(await row(request.request.id)).toMatchObject({status:'rejected',decision_reason:'left the cache',decided_at:expect.any(Number),decision_token:member!.operation_token})
  for(const request of [elsewhere,outgoingB,unrelated])expect((await row(request.request.id))?.status).toBe('pending')
  expect((await row(approved.request.id))?.status).toBe('approved')
  expect(await itemDetail(env.DB,f.owned.id,f.member)).toMatchObject({quantity:9,available_quantity:6})
  expect(await env.DB.prepare('SELECT cache_id FROM item_caches WHERE item_id=?').bind(f.owned.id).all()).toMatchObject({results:[{cache_id:f.b.id}]})
  expect((await libraryItems(env.DB,f.member)).map(item=>item.id)).toEqual([f.owned.id])
  expect((await cacheItems(env.DB,f.a.id,f.owner)).map(item=>item.id)).not.toContain(f.owned.id)
  expect((await itemDetail(env.DB,f.owned.id,f.member,f.b.id)).id).toBe(f.owned.id)
  expect(await env.BUCKET.head(key)).not.toBeNull()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM r2_cleanup').first('n')).toBe(0)
  await expect(cacheDetail(env.DB,f.a.id,f.member)).rejects.toMatchObject({status:404})
  await expect(joinCache(env.DB,f.a.id,f.member,f.a.invite_token.split('.')[1])).rejects.toMatchObject({status:403,code:'member_removed'})
  await expect(joinCache(env.DB,f.a.id,f.member,'wrong')).rejects.toMatchObject({status:404})
  const events = (await outbox()).results.filter(event=>event.kind==='member_removed')
  expect(events).toHaveLength(2)
  expect(events.map(event=>JSON.parse(event.payload).recipient_id).sort()).toEqual([f.member,f.neighbor].sort())
  expect(JSON.stringify(events)).not.toContain('example.test')
})

it('voluntary leave uses the same cleanup, returns 404 while left and rejoins without restoring old attachments', async () => {
  const f = await fixture(), key = await photo(f.owned.id,f.member)
  const incoming = await createRequest(env.DB,f.owned.id,f.a.id,f.neighbor,2), outgoing = await createRequest(env.DB,f.other.id,f.a.id,f.member,2)
  await removeCacheMember(env.DB,f.a.id,f.member,f.member,true)
  expect((await membership(f.a.id,f.member))?.status).toBe('left')
  expect((await row(incoming.request.id))?.status).toBe('rejected')
  expect((await row(outgoing.request.id))?.status).toBe('rejected')
  await expect(cacheDetail(env.DB,f.a.id,f.member)).rejects.toMatchObject({status:404})
  await expect(joinCache(env.DB,f.a.id,f.member,'wrong')).rejects.toMatchObject({status:404})
  expect((await joinCache(env.DB,f.a.id,f.member,f.a.invite_token.split('.')[1])).membership.status).toBe('active')
  expect((await cacheDetail(env.DB,f.a.id,f.member)).id).toBe(f.a.id)
  await expect(itemDetail(env.DB,f.owned.id,f.member,f.a.id)).rejects.toMatchObject({status:404})
  expect((await itemDetail(env.DB,f.owned.id,f.member)).id).toBe(f.owned.id)
  expect(await env.BUCKET.head(key)).not.toBeNull()
  expect((await row(incoming.request.id))?.status).toBe('rejected')
})

it('a former member rejoining a gated cache becomes pending once and still has no old attachments', async () => {
  const f = await fixture()
  await removeCacheMember(env.DB,f.a.id,f.member,f.member,true)
  await updateCache(env.DB,f.a.id,f.owner,{requires_approval:true})
  const results = await Promise.all([joinCache(env.DB,f.a.id,f.member,f.a.invite_token.split('.')[1]),joinCache(env.DB,f.a.id,f.member,f.a.invite_token.split('.')[1])])
  expect(results.every(result=>result.membership.status==='pending')).toBe(true)
  expect(results.filter(result=>result.notificationId)).toHaveLength(1)
  await expect(cacheDetail(env.DB,f.a.id,f.member)).rejects.toMatchObject({status:404})
  await decideCacheJoin(env.DB,f.a.id,f.owner,f.member,'approve')
  await expect(itemDetail(env.DB,f.owned.id,f.member,f.a.id)).rejects.toMatchObject({status:404})
})

it('forbids owner leave/removal and non-owner removal with no state, outbox or cleanup effects', async () => {
  const f = await fixture(), request = await createRequest(env.DB,f.owned.id,f.a.id,f.neighbor,2), before = (await outbox()).results
  await expect(removeCacheMember(env.DB,f.a.id,f.owner,f.owner,true)).rejects.toMatchObject({status:409,code:'owner_cannot_leave'})
  await expect(removeCacheMember(env.DB,f.a.id,f.owner,f.owner)).rejects.toMatchObject({status:409,code:'owner_cannot_be_removed'})
  for(const caller of [f.member,f.neighbor,f.outsider])await expect(removeCacheMember(env.DB,f.a.id,caller,f.member)).rejects.toMatchObject({status:404})
  await expect(removeCacheMember(env.DB,f.a.id,f.outsider,f.outsider,true)).rejects.toMatchObject({status:404})
  expect((await row(request.request.id))?.status).toBe('pending')
  expect((await membership(f.a.id,f.member))?.status).toBe('active')
  expect((await outbox()).results).toEqual(before)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM r2_cleanup').first('n')).toBe(0)
})

it('concurrent double removal has one winner and exactly one closure event for each affected request', async () => {
  const f = await fixture(), request = await createRequest(env.DB,f.owned.id,f.a.id,f.neighbor,2)
  const results = await Promise.allSettled([removeCacheMember(env.DB,f.a.id,f.owner,f.member),removeCacheMember(env.DB,f.a.id,f.owner,f.member)])
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1)
  expect((results.find(result=>result.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({status:404})
  expect((await outbox()).results.filter(event=>event.id===request.request.id)).toHaveLength(1)
})

it('detach rejects only pending via that attachment and preserves photos, library, stock and other caches', async () => {
  const f = await fixture(), key = await photo(f.owned.id,f.member)
  const a = await createRequest(env.DB,f.owned.id,f.a.id,f.neighbor,2), b = await createRequest(env.DB,f.owned.id,f.b.id,f.neighbor,3)
  await expect(detachItem(env.DB,f.owned.id,f.a.id,f.owner)).rejects.toMatchObject({status:404})
  expect(await detachItem(env.DB,f.owned.id,f.a.id,f.member)).toEqual([a.request.id])
  const event = (await outbox()).results.find(event=>event.id===a.request.id)!
  expect(notificationContent({...event,attempts:0},env.APP_BASE_URL).path).toBe('/requests')
  expect(await row(a.request.id)).toMatchObject({status:'rejected',decision_reason:'item no longer shared in this cache'})
  expect((await row(b.request.id))?.status).toBe('pending')
  expect(await itemDetail(env.DB,f.owned.id,f.member)).toMatchObject({quantity:10,available_quantity:7})
  await expect(itemDetail(env.DB,f.owned.id,f.member,f.a.id)).rejects.toMatchObject({status:404})
  expect(await env.BUCKET.head(key)).not.toBeNull()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM r2_cleanup').first('n')).toBe(0)
  await expect(detachItem(env.DB,f.owned.id,f.a.id,f.member)).rejects.toMatchObject({status:404})
  await attachItem(env.DB,f.owned.id,f.a.id,f.member)
  expect((await row(a.request.id))?.status).toBe('rejected')
  expect((await createRequest(env.DB,f.owned.id,f.a.id,f.neighbor,1)).request.status).toBe('pending')
})

it('global deletion snapshots pending in every cache before cascade and commits exact/prefix cleanup', async () => {
  const f = await fixture(), key = await photo(f.owned.id,f.member), keep = await photo(f.other.id,f.owner)
  const a = await createRequest(env.DB,f.owned.id,f.a.id,f.neighbor,2), b = await createRequest(env.DB,f.owned.id,f.b.id,f.neighbor,3)
  const approved = await createRequest(env.DB,f.owned.id,f.a.id,f.owner,1)
  await decideRequest(env.DB,approved.request.id,f.member,'approve',decisionInput({},'approve'))
  const orphan = `${f.member}/${f.owned.id}/${crypto.randomUUID()}`, boundary = `${f.member}/${f.owned.id}x/${crypto.randomUUID()}`
  await env.BUCKET.put(orphan,'orphan');await env.BUCKET.put(boundary,'keep')
  await expect(deleteItem(env.DB,f.owned.id,f.owner)).rejects.toMatchObject({status:404})
  const ids = await deleteItem(env.DB,f.owned.id,f.member,f.a.id)
  expect(ids.sort()).toEqual([a.request.id,b.request.id].sort())
  await expect(itemDetail(env.DB,f.owned.id,f.member)).rejects.toMatchObject({status:404})
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM requests WHERE item_id=?').bind(f.owned.id).first('n')).toBe(0)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM item_caches WHERE item_id=?').bind(f.owned.id).first('n')).toBe(0)
  const cleanup = (await env.DB.prepare('SELECT kind,target FROM r2_cleanup ORDER BY kind').all()).results
  expect(cleanup).toEqual([{kind:'exact',target:key},{kind:'prefix',target:`${f.member}/${f.owned.id}/`}])
  const snapshots = (await outbox()).results.filter(event=>event.kind==='item_deleted')
  expect(snapshots).toHaveLength(2)
  expect(snapshots.every(event=>JSON.parse(event.payload).item_title==='Member sugar')).toBe(true)
  expect(await env.BUCKET.head(key)).not.toBeNull()
  const fail = vi.spyOn(env.BUCKET,'delete').mockRejectedValue(new Error('injected R2 failure'))
  await sweepPhotoCleanup(env)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM r2_cleanup').first('n')).toBe(2)
  fail.mockRestore()
  for(let tick=0;tick<4;tick++)await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(key)).toBeNull();expect(await env.BUCKET.head(orphan)).toBeNull()
  expect(await env.BUCKET.head(keep)).not.toBeNull();expect(await env.BUCKET.head(boundary)).not.toBeNull()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM r2_cleanup').first('n')).toBe(0)
  await expect(deleteItem(env.DB,f.owned.id,f.member)).rejects.toMatchObject({status:404})
  const mail = vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({id:'notification'}))
  expect(await deliverNotification(env,snapshots[0].id)).toBe('ack')
  expect(JSON.parse(mail.mock.calls[0][1]!.body as string).to).toEqual([`${f.neighbor}@example.test`])
})

it('private global delete remains owner-authorized after cache loss but the cache alias is not a stale grant', async () => {
  const f = await fixture()
  await removeCacheMember(env.DB,f.a.id,f.member,f.member,true)
  await expect(deleteItem(env.DB,f.owned.id,f.member,f.a.id)).rejects.toMatchObject({status:404})
  expect((await itemDetail(env.DB,f.owned.id,f.member,f.b.id)).id).toBe(f.owned.id)
  await deleteItem(env.DB,f.owned.id,f.member)
  await expect(itemDetail(env.DB,f.owned.id,f.member)).rejects.toMatchObject({status:404})
})

for(const ownedDirection of [false,true]) {
  it(`removal racing a ${ownedDirection?'request on the removed owner item':'request from the removed requester'} includes every successful create`, async () => {
    for(const removeFirst of [false,true]) {
      const f = await fixture(), item = ownedDirection?f.owned:f.other, caller = ownedDirection?f.neighbor:f.member
      const ask = ()=>createRequest(env.DB,item.id,f.a.id,caller,1), remove = ()=>removeCacheMember(env.DB,f.a.id,f.owner,f.member)
      const results = await Promise.allSettled(removeFirst?[remove(),ask()]:[ask(),remove()])
      expect(results[removeFirst?0:1].status).toBe('fulfilled')
      const created = results[removeFirst?1:0]
      if(created.status==='fulfilled') {
        const request = (created.value as Awaited<ReturnType<typeof createRequest>>).request
        expect((await row(request.id))?.status).toBe('rejected')
        expect((await outbox()).results.find(event=>event.id===request.id)?.kind).toBe('member_removed')
      } else expect(created.reason).toMatchObject({status:404})
      expect(await affectedPending(f.a.id,f.member)).toBe(0)
      await expect(ask()).rejects.toMatchObject({status:404})
    }
  })
}

for(const incoming of [false,true]) {
  it(`approval versus removal (${incoming?'item owner removed':'requester removed'}) completes once or is rejected without deduction`, async () => {
    for(const removeFirst of [false,true]) {
      const f = await fixture(), item = incoming?f.owned:f.other, caller = incoming?f.neighbor:f.member, owner = incoming?f.member:f.owner
      const request = await createRequest(env.DB,item.id,f.a.id,caller,2)
      const approve = ()=>decideRequest(env.DB,request.request.id,owner,'approve',decisionInput({},'approve'))
      const remove = ()=>removeCacheMember(env.DB,f.a.id,f.owner,f.member)
      const results = await Promise.allSettled(removeFirst?[remove(),approve()]:[approve(),remove()])
      expect(results[removeFirst?0:1].status).toBe('fulfilled')
      const stored = await row(request.request.id)
      expect(['approved','rejected']).toContain(stored?.status)
      expect((await itemDetail(env.DB,item.id,owner)).quantity).toBe(stored?.status==='approved'?8:10)
      const events = (await outbox()).results.filter(event=>['request_approved','member_removed'].includes(event.kind) && JSON.parse(event.payload).request_id===request.request.id)
      expect(events).toHaveLength(1)
      expect(await affectedPending(f.a.id,f.member)).toBe(0)
    }
  })
}

it('attachment/removal races cannot leave a removed owner attachment behind', async () => {
  for(const removeFirst of [false,true]) {
    const f = await fixture(), attach = ()=>attachItem(env.DB,f.owned.id,f.a.id,f.member), remove = ()=>removeCacheMember(env.DB,f.a.id,f.owner,f.member)
    const results = await Promise.allSettled(removeFirst?[remove(),attach()]:[attach(),remove()])
    expect(results[removeFirst?0:1].status).toBe('fulfilled')
    expect(await env.DB.prepare('SELECT 1 FROM item_caches WHERE item_id=? AND cache_id=?').bind(f.owned.id,f.a.id).first()).toBeNull()
    expect((await itemDetail(env.DB,f.owned.id,f.member,f.b.id)).id).toBe(f.owned.id)
  }
})

for(const global of [false,true]) {
  it(`request versus ${global?'global delete':'detach'} snapshots successful creates or refuses them`, async () => {
    for(const destroyFirst of [false,true]) {
      const f = await fixture(), ask = ()=>createRequest(env.DB,f.owned.id,f.a.id,f.neighbor,1)
      const destroy = ()=>global?deleteItem(env.DB,f.owned.id,f.member):detachItem(env.DB,f.owned.id,f.a.id,f.member)
      const results = await Promise.allSettled(destroyFirst?[destroy(),ask()]:[ask(),destroy()])
      expect(results[destroyFirst?0:1].status).toBe('fulfilled')
      const created = results[destroyFirst?1:0]
      if(created.status==='fulfilled')expect((await outbox()).results.find(event=>event.id===(created.value as Awaited<ReturnType<typeof createRequest>>).request.id)?.kind).toBe(global?'item_deleted':'request_rejected')
      else expect(created.reason).toMatchObject({status:404})
      expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE item_id=? AND cache_id=? AND status='pending'").bind(f.owned.id,f.a.id).first('n')).toBe(0)
    }
  })
}

for(const operation of ['removal','detach','delete']) {
  it(`rolls the entire ${operation} batch back when its final source deletion fails`, async () => {
    const f = await fixture(), key = await photo(f.owned.id,f.member), request = await createRequest(env.DB,f.owned.id,f.a.id,f.neighbor,2)
    const before = (await outbox()).results, member = await membership(f.a.id,f.member)
    await env.DB.exec(operation==='delete'
      ? "CREATE TRIGGER fail_final BEFORE DELETE ON items BEGIN SELECT RAISE(ABORT,'injected final failure'); END"
      : "CREATE TRIGGER fail_final BEFORE DELETE ON item_caches BEGIN SELECT RAISE(ABORT,'injected final failure'); END")
    const call = operation==='removal'?removeCacheMember(env.DB,f.a.id,f.owner,f.member):operation==='detach'?detachItem(env.DB,f.owned.id,f.a.id,f.member):deleteItem(env.DB,f.owned.id,f.member)
    await expect(call).rejects.toThrow('injected final failure')
    expect(await membership(f.a.id,f.member)).toEqual(member)
    expect((await row(request.request.id))?.status).toBe('pending')
    expect((await itemDetail(env.DB,f.owned.id,f.member,f.a.id)).id).toBe(f.owned.id)
    expect((await outbox()).results).toEqual(before)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM r2_cleanup').first('n')).toBe(0)
    expect(await env.BUCKET.head(key)).not.toBeNull()
  })
}

for(const operation of ['removal','leave','detach','delete']) {
  it(`rolls ${operation} back when recipient snapshot insertion fails`, async () => {
    const f = await fixture(), request = await createRequest(env.DB,f.owned.id,f.a.id,f.neighbor,1), before = (await outbox()).results
    await env.DB.exec("CREATE TRIGGER fail_snapshot BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'injected snapshot failure'); END")
    const call = operation==='removal'?removeCacheMember(env.DB,f.a.id,f.owner,f.member):operation==='leave'?removeCacheMember(env.DB,f.a.id,f.member,f.member,true):operation==='detach'?detachItem(env.DB,f.owned.id,f.a.id,f.member):deleteItem(env.DB,f.owned.id,f.member)
    await expect(call).rejects.toThrow('injected snapshot failure')
    expect((await membership(f.a.id,f.member))?.status).toBe('active')
    expect((await row(request.request.id))?.status).toBe('pending')
    expect((await itemDetail(env.DB,f.owned.id,f.member,f.a.id)).id).toBe(f.owned.id)
    expect((await outbox()).results).toEqual(before)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM r2_cleanup').first('n')).toBe(0)
  })
}

it('global delete rolls back snapshots/state if cleanup intent insertion fails', async () => {
  const f = await fixture(), request = await createRequest(env.DB,f.owned.id,f.a.id,f.neighbor,1), before = (await outbox()).results
  await env.DB.exec("CREATE TRIGGER fail_cleanup BEFORE INSERT ON r2_cleanup BEGIN SELECT RAISE(ABORT,'injected cleanup failure'); END")
  await expect(deleteItem(env.DB,f.owned.id,f.member)).rejects.toThrow('injected cleanup failure')
  expect((await row(request.request.id))?.status).toBe('pending')
  expect((await itemDetail(env.DB,f.owned.id,f.member,f.a.id)).id).toBe(f.owned.id)
  expect((await outbox()).results).toEqual(before)
})

it('covers every row in a large atomic cascade while bounding Queue hints to 25', async () => {
  const f = await fixture(), ids = Array.from({length:70},()=>crypto.randomUUID())
  await env.DB.prepare('UPDATE items SET quantity=9999 WHERE id=?').bind(f.owned.id).run()
  await env.DB.prepare("INSERT INTO requests(id,item_id,cache_id,requester_id,quantity,status,created_at,creation_token) SELECT value,?,?,?,1,'pending',1,value FROM json_each(?)")
    .bind(f.owned.id,f.a.id,f.neighbor,JSON.stringify(ids)).run()
  const batches = vi.spyOn(env.DB,'batch')
  const hints = await removeCacheMember(env.DB,f.a.id,f.owner,f.member)
  expect(batches).toHaveBeenCalledTimes(1)
  expect(batches.mock.calls[0][0]).toHaveLength(5)
  expect(hints).toHaveLength(25)
  expect(await affectedPending(f.a.id,f.member)).toBe(0)
  expect((await outbox()).results.filter(event=>event.kind==='member_removed')).toHaveLength(70)
  await env.DB.prepare('UPDATE outbox SET created_at=0').run()
  const send = vi.spyOn(env.NOTIFICATIONS,'sendBatch')
  for(let tick=0;tick<3;tick++)await sweepNotifications(env)
  const queued = new Set(send.mock.calls.flatMap(call=>Array.from(call[0],message=>message.body)))
  expect([...queued].sort()).toEqual(ids.sort())
})

it('HTTP remove/leave/detach/global-delete paths enforce auth, Origin and current D1 ownership, not DOs', async () => {
  const owner = await login('owner@example.test'), member = await login('member@example.test')
  for(const caller of [owner,member])await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:caller.cookie,body:{display_name:'Neighbor'}}),env)
  const cache = await createCache(env.DB,owner.id,'Tools',false), secret = cache.invite_token.split('.')[1]
  await joinCache(env.DB,cache.id,member.id,secret)
  const item = await createItem(env.DB,member.id,itemChanges({title:'Mixer',is_consumable:false},true),cache.id)
  const poisoned = {...env,CACHES:{get:()=>{throw new Error('No legacy DO access')}}} as unknown as Env
  const leave = `/api/caches/${cache.id}/leave`, remove = `/api/caches/${cache.id}/members/${member.id}`
  expect((await worker.fetch(appRequest(leave,{method:'POST',body:{}}),poisoned)).status).toBe(401)
  for(const origin of [null,'null','https://foreign.test'])expect((await worker.fetch(appRequest(leave,{method:'POST',cookie:member.cookie,origin,body:{}}),poisoned)).status).toBe(403)
  expect((await worker.fetch(appRequest(leave,{method:'POST',cookie:owner.cookie,body:{}}),poisoned)).status).toBe(409)
  expect((await worker.fetch(appRequest(leave,{method:'POST',cookie:member.cookie,body:{}}),poisoned)).status).toBe(204)
  expect((await worker.fetch(appRequest(`/api/caches/${cache.id}`,{cookie:member.cookie}),poisoned)).status).toBe(404)
  expect((await worker.fetch(appRequest(`/api/caches/${cache.id}/join`,{method:'POST',cookie:member.cookie,body:{secret}}),poisoned)).status).toBe(200)
  await attachItem(env.DB,item.id,cache.id,member.id)
  const detach = `/api/me/items/${item.id}/attachments/${cache.id}`
  expect((await worker.fetch(appRequest(detach,{method:'DELETE',cookie:owner.cookie}),poisoned)).status).toBe(404)
  expect((await worker.fetch(appRequest(detach,{method:'DELETE',cookie:member.cookie}),poisoned)).status).toBe(204)
  await attachItem(env.DB,item.id,cache.id,member.id)
  expect((await worker.fetch(appRequest(`/api/caches/${cache.id}/items/${item.id}`,{method:'DELETE',cookie:owner.cookie}),poisoned)).status).toBe(404)
  expect((await worker.fetch(appRequest(`/api/caches/${cache.id}/items/${item.id}`,{method:'DELETE',cookie:member.cookie}),poisoned)).status).toBe(204)
  const unshared = await createItem(env.DB,member.id,itemChanges({title:'Unshared',is_consumable:false},true))
  expect((await worker.fetch(appRequest(`/api/me/items/${unshared.id}`,{method:'DELETE',cookie:member.cookie}),poisoned)).status).toBe(204)
  expect((await worker.fetch(appRequest(remove,{method:'DELETE',cookie:owner.cookie}),poisoned)).status).toBe(204)
  expect((await worker.fetch(appRequest(`/api/caches/${cache.id}/join`,{method:'POST',cookie:member.cookie,body:{secret}}),poisoned)).status).toBe(403)
})

it('HTTP removal commits all work despite Queue failure, with immediate private photo gates and Cron rescue', async () => {
  const owner = await login('owner@example.test'), member = await login('member@example.test'), neighbor = await user()
  for(const caller of [owner,member])await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:caller.cookie,body:{display_name:'Neighbor'}}),env)
  const cache = await createCache(env.DB,owner.id,'Tools',false)
  for(const id of [member.id,neighbor])await joinCache(env.DB,cache.id,id,cache.invite_token.split('.')[1])
  const item = await createItem(env.DB,member.id,itemChanges({title:'Mixer',is_consumable:false},true),cache.id), key = await photo(item.id,member.id)
  const request = await createRequest(env.DB,item.id,cache.id,neighbor,null)
  const send = vi.spyOn(env.NOTIFICATIONS,'sendBatch').mockRejectedValue(new Error('injected Queue failure'))
  expect((await worker.fetch(appRequest(`/api/caches/${cache.id}/members/${member.id}`,{method:'DELETE',cookie:owner.cookie}),env)).status).toBe(204)
  expect((await row(request.request.id))?.status).toBe('rejected')
  expect((await outbox()).results.find(event=>event.id===request.request.id)?.kind).toBe('member_removed')
  expect((await worker.fetch(appRequest(`/api/caches/${cache.id}/items/${item.id}/photo`,{cookie:owner.cookie}),env)).status).toBe(404)
  expect((await worker.fetch(appRequest(`/api/me/items/${item.id}/photo`,{cookie:member.cookie}),env)).status).toBe(200)
  expect(await env.BUCKET.head(key)).not.toBeNull()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM r2_cleanup').first('n')).toBe(0)
  send.mockRestore()
  await env.DB.prepare('UPDATE outbox SET created_at=0 WHERE id=?').bind(request.request.id).run()
  const rescue = vi.spyOn(env.NOTIFICATIONS,'sendBatch')
  await sweepNotifications(env)
  expect(rescue).toHaveBeenCalledWith([{body:request.request.id}])
})

it('a late upload after global-delete prefix cleanup records fresh exact-key work and cannot attach', async () => {
  const member = await login()
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:member.cookie,body:{display_name:'Owner'}}),env)
  const item = await createItem(env.DB,member.id,itemChanges({title:'Mixer',is_consumable:false},true)), put = env.BUCKET.put.bind(env.BUCKET)
  vi.spyOn(env.BUCKET,'put').mockImplementation(async(key,body,options)=>{
    await deleteItem(env.DB,item.id,member.id)
    await sweepPhotoCleanup(env)
    return put(key,body,options)
  })
  const response = await worker.fetch(new Request(base+`/api/me/items/${item.id}/photo`,{method:'POST',headers:{Origin:base,Cookie:member.cookie,'Content-Type':'image/png'},body:new Uint8Array([137,80,78,71,13,10,26,10])}),env)
  expect(response.status).toBe(404)
  const rows = (await env.DB.prepare('SELECT kind,target FROM r2_cleanup').all<{kind:string;target:string}>()).results
  expect(rows).toHaveLength(1);expect(rows[0].kind).toBe('exact')
  expect(await env.BUCKET.head(rows[0].target)).not.toBeNull()
  await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(rows[0].target)).toBeNull()
})
