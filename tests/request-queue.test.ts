import { expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import worker from '../src/index'
import { attachItem, createCache, createItem, decideRequest, incomingRequestsPage, itemRequests, joinCache, requestDetail, requestsPage } from '../src/db'
import { itemChanges } from '../src/items'
import { decisionInput } from '../src/requests'
import { appRequest, login } from './helpers'

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`
async function fixture() {
  const owner = await login('queue-owner@example.test'), first = await login('queue-first@example.test'), second = await login('queue-second@example.test'), neighbor = await login('queue-neighbor@example.test')
  await env.DB.batch([owner,first,second,neighbor].map(user => env.DB.prepare("UPDATE user SET display_name=?,plan='plus' WHERE id=?").bind(user === second ? 'Hidden other-cache person' : 'Neighbor',user.id)))
  const a = await createCache(env.DB,owner.id,'Visible cache',false), b = await createCache(env.DB,owner.id,'Hidden other cache',false)
  for (const user of [first,neighbor]) await joinCache(env.DB,a.id,user.id,a.invite_token.split('.')[1])
  await joinCache(env.DB,b.id,second.id,b.invite_token.split('.')[1])
  const item = await createItem(env.DB,owner.id,itemChanges({title:'Drill',is_consumable:false,quantity:null},true),a.id)
  await attachItem(env.DB,item.id,b.id,owner.id)
  async function insert(n: number, time: number, cache = a, requester = first, itemId = item.id, quantity: number | null = null) {
    await env.DB.prepare("INSERT INTO requests(id,item_id,cache_id,requester_id,quantity,status,created_at,creation_token) VALUES (?,?,?,?,?,'pending',?,?)")
      .bind(id(n),itemId,cache.id,requester.id,quantity,time,crypto.randomUUID()).run()
  }
  return { owner,first,second,neighbor,a,b,item,insert }
}

it('counts pending reusable requests across caches with deterministic ID ties, without disclosing other-cache rows', async () => {
  const f = await fixture()
  await f.insert(2,100); await f.insert(1,100,f.b,f.second); await f.insert(3,200)
  const incoming = await incomingRequestsPage(env.DB,f.owner.id,null)
  expect(incoming.requests.map(row => [row.id,row.queue_position])).toEqual([[id(1),1],[id(2),2],[id(3),3]])
  const outgoing = await requestsPage(env.DB,f.first.id,null)
  expect(outgoing.requests.map(row => [row.id,row.queue_position])).toEqual([[id(3),3],[id(2),2]])
  const privateText = JSON.stringify(outgoing)
  for (const hidden of [id(1),f.b.id,f.second.id,'Hidden other-cache person','Hidden other cache','example.test','oldest_at']) expect(privateText).not.toContain(hidden)
  expect(await requestDetail(env.DB,id(2),f.first.id)).toMatchObject({queue_position:2})
  await expect(requestDetail(env.DB,id(1),f.first.id)).rejects.toMatchObject({status:404})
  expect((await incomingRequestsPage(env.DB,f.first.id,null)).requests).toEqual([])
  const local = await itemRequests(env.DB,f.item.id,f.a.id,f.neighbor.id)
  expect(local.map(row => row.id)).toEqual([id(2),id(3)])
  expect(local.every(row => row.queue_position === null)).toBe(true)
  expect((await itemRequests(env.DB,f.item.id,f.a.id,f.owner.id)).map(row => row.queue_position)).toEqual([2,3])
  // Queue position is guidance, not an approval guard.
  await decideRequest(env.DB,id(3),f.owner.id,'approve',decisionInput({},'approve'))
  expect(await requestDetail(env.DB,id(3),f.first.id)).toMatchObject({status:'approved',queue_position:null})
  await decideRequest(env.DB,id(1),f.owner.id,'reject',decisionInput({reason:'Unavailable'},'reject'))
  expect(await requestDetail(env.DB,id(2),f.first.id)).toMatchObject({queue_position:1})
})

it('hides requester positions for consumables and all decided rows while retaining owner pending ordinals', async () => {
  const f = await fixture()
  const stock = await createItem(env.DB,f.owner.id,itemChanges({title:'Sugar',is_consumable:true,quantity:5},true),f.a.id)
  await f.insert(1,1,f.a,f.first,stock.id,1)
  expect(await requestDetail(env.DB,id(1),f.first.id)).toMatchObject({queue_position:null})
  expect((await incomingRequestsPage(env.DB,f.owner.id,null)).requests[0]).toMatchObject({queue_position:1})
  await decideRequest(env.DB,id(1),f.owner.id,'reject',decisionInput({reason:'Not today'},'reject'))
  expect(await requestDetail(env.DB,id(1),f.owner.id)).toMatchObject({queue_position:null})
  expect((await incomingRequestsPage(env.DB,f.owner.id,null)).requests).toEqual([])
})

it('pages whole owner item queues longest-waiting first and keeps ordinals across page boundaries', async () => {
  const f = await fixture()
  for (let n=1;n<=28;n++) await f.insert(n,100)
  const older = await createItem(env.DB,f.owner.id,itemChanges({title:'Mixer',is_consumable:false,quantity:null},true),f.a.id)
  await f.insert(100,50,f.a,f.first,older.id)
  const first = await incomingRequestsPage(env.DB,f.owner.id,null)
  const second = await incomingRequestsPage(env.DB,f.owner.id,first.next_cursor)
  expect(first.requests).toHaveLength(25)
  expect(first.requests[0]).toMatchObject({item_id:older.id,queue_position:1})
  expect(first.requests.slice(1).map(row => row.id)).toEqual(Array.from({length:24},(_,n) => id(n+1)))
  expect(second.requests.map(row => [row.id,row.queue_position])).toEqual([[id(25),25],[id(26),26],[id(27),27],[id(28),28]])
  expect(second.next_cursor).toBeNull()
  for (const after of ['bad','1x'+f.item.id+'.100.'+id(1),`9999999999999999.${f.item.id}.1.${id(1)}`]) {
    await expect(incomingRequestsPage(env.DB,f.owner.id,after)).rejects.toMatchObject({status:400,code:'invalid_cursor'})
  }
  const columns = (await env.DB.prepare('PRAGMA index_info(pending_requests)').all<{name:string}>()).results.map(row => row.name)
  expect(columns).toEqual(['item_id','created_at','id'])
})

it('upgrades the pending index without changing populated request rows', async () => {
  const f = await fixture(); await f.insert(1,1)
  const before = (await env.DB.prepare('SELECT * FROM requests').all()).results
  await env.DB.exec("DROP INDEX pending_requests; CREATE INDEX pending_requests ON requests(item_id) WHERE status='pending'")
  const migration = (env as unknown as {TEST_MIGRATIONS:D1Migration[]}).TEST_MIGRATIONS.find(row => row.name.includes('0019_request_queue'))!
  await env.DB.prepare('DELETE FROM d1_migrations WHERE name=?').bind(migration.name).run()
  await applyD1Migrations(env.DB,[migration])
  expect((await env.DB.prepare('SELECT * FROM requests').all()).results).toEqual(before)
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
})

it('guards the owner queue API by the current caller and rejects unknown views', async () => {
  const f = await fixture(); await f.insert(1,1)
  expect((await worker.fetch(appRequest('/api/requests?view=incoming'),env)).status).toBe(401)
  const own = await worker.fetch(appRequest('/api/requests?view=incoming',{cookie:f.owner.cookie}),env)
  expect(await own.json()).toMatchObject({requests:[{id:id(1),queue_position:1}],next_cursor:null})
  const other = await worker.fetch(appRequest('/api/requests?view=incoming',{cookie:f.neighbor.cookie}),env)
  expect(await other.json()).toMatchObject({requests:[],next_cursor:null})
  expect((await worker.fetch(appRequest('/api/requests?view=everyone',{cookie:f.owner.cookie}),env)).status).toBe(400)
})
