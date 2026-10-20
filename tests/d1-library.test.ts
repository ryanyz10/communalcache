import { expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { attachItem, createCache, createItem, createRequest, detachItem, itemDetail, joinCache, libraryPage, removeCacheMember, updateItem } from '../src/db'
import { itemChanges } from '../src/items'
import { appRequest, login } from './helpers'

async function user(name = 'Neighbor') {
  const id = crypto.randomUUID(), now = new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?,?,?,1,?,?,?)').bind(id,'',`${id}@example.test`,now,now,name).run()
  return id
}

it('returns own unshared and multi-cache items with active cache names, shared stock and all-cache pending counts, never requester identities', async () => {
  const owner = await user(), neighbor = await user(), outsider = await user()
  await env.DB.prepare("UPDATE user SET plan='plus' WHERE id=?").bind(owner).run()
  const a = await createCache(env.DB,owner,'Maple Street',false), b = await createCache(env.DB,owner,'Garden Club',false)
  for (const cache of [a,b]) await joinCache(env.DB,cache.id,neighbor,cache.invite_token.split('.')[1])
  const item = await createItem(env.DB,owner,itemChanges({title:'Starter',is_consumable:true,quantity:8},true),a.id)
  const privateItem = await createItem(env.DB,owner,itemChanges({title:'Tent',is_consumable:false},true))
  await attachItem(env.DB,item.id,b.id,owner)
  await createRequest(env.DB,item.id,a.id,neighbor,2)
  await createRequest(env.DB,item.id,b.id,neighbor,1)
  await updateItem(env.DB,item.id,owner,itemChanges({available:false},false))
  const page = await libraryPage(env.DB,owner,null)
  expect(page.items).toHaveLength(2)
  const shared = page.items.find(row => row.id === item.id)!
  expect(shared).toMatchObject({cache_id:null,quantity:8,available_quantity:5,pending_count:2,available:false,caches:[{id:b.id,name:'Garden Club'},{id:a.id,name:'Maple Street'}]})
  expect(shared).not.toHaveProperty('unavailable_note')
  expect(page.items.find(row=>row.id===privateItem.id)).toMatchObject({caches:[],pending_count:0})
  expect(await libraryPage(env.DB,outsider,null)).toEqual({items:[],next_cursor:null,totals:{total_count:0,lend_count:0,give_count:0,unshared_count:0,shared_cache_count:0}})
  await expect(itemDetail(env.DB,item.id,neighbor)).rejects.toMatchObject({status:404})
  const publicItem = await itemDetail(env.DB,item.id,neighbor,a.id)
  expect(publicItem).not.toHaveProperty('caches')
  expect(publicItem).not.toHaveProperty('pending_count')
  for (const field of ['requester_id','requester_name','photo_path','caches_json','operation_token','example.test']) expect(JSON.stringify(page)).not.toContain(field)
  await detachItem(env.DB,item.id,b.id,owner)
  expect(await itemDetail(env.DB,item.id,owner)).toMatchObject({pending_count:1,caches:[{id:a.id,name:'Maple Street'}]})
})

it('rechecks active membership in cache-name enrichment, including stale attachments, and preserves the private library after removal', async () => {
  const admin = await user(), owner = await user()
  const cache = await createCache(env.DB,admin,'Private group',false)
  await joinCache(env.DB,cache.id,owner,cache.invite_token.split('.')[1])
  const item = await createItem(env.DB,owner,itemChanges({title:'Ladder',is_consumable:false},true),cache.id)
  for (const status of ['pending','removed','left']) {
    await env.DB.prepare('UPDATE memberships SET status=? WHERE cache_id=? AND user_id=?').bind(status,cache.id,owner).run()
    expect((await libraryPage(env.DB,owner,null)).items[0].caches).toEqual([])
    expect(await itemDetail(env.DB,item.id,owner)).toMatchObject({caches:[]})
  }
  await env.DB.prepare("UPDATE memberships SET status='active' WHERE cache_id=? AND user_id=?").bind(cache.id,owner).run()
  await removeCacheMember(env.DB,cache.id,admin,owner)
  expect((await libraryPage(env.DB,owner,null)).items[0]).toMatchObject({id:item.id,caches:[]})
})

it('paginates canonical rows stably across equal timestamps and an intervening new item without duplicates or other owners', async () => {
  const owner = await user(), other = await user(), ids: string[] = []
  for (let index=0;index<28;index++) {
    const item = await createItem(env.DB,owner,itemChanges({title:`Item ${index}`,is_consumable:false},true))
    ids.push(item.id)
  }
  await env.DB.prepare('UPDATE items SET created_at=100 WHERE owner_id=?').bind(owner).run()
  await createItem(env.DB,other,itemChanges({title:'Not yours',is_consumable:false},true))
  const first = await libraryPage(env.DB,owner,null)
  expect(first.items).toHaveLength(25)
  expect(first.next_cursor).toBeTruthy()
  const newer = await createItem(env.DB,owner,itemChanges({title:'New arrival',is_consumable:false},true))
  const second = await libraryPage(env.DB,owner,first.next_cursor!.toUpperCase())
  expect(second.items).toHaveLength(3)
  expect(second.next_cursor).toBeNull()
  expect([...first.items,...second.items].map(row=>row.id)).toEqual(ids.sort().reverse())
  expect(second.items.map(row=>row.id)).not.toContain(newer.id)
  for (const cursor of ['', 'bogus','9007199254740992.11111111-1111-4111-8111-111111111111']) await expect(libraryPage(env.DB,owner,cursor)).rejects.toMatchObject({status:400,code:'invalid_cursor'})
})

it('serves the paginated owner library over the authenticated API with no-store, no DO access and cursor validation', async () => {
  const owner = await login()
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:owner.cookie,body:{display_name:'Owner'}}),env)
  const item = await createItem(env.DB,owner.id,itemChanges({title:'Unshared tent',is_consumable:false},true))
  const poisoned = env
  const response = await worker.fetch(appRequest('/api/me/items',{cookie:owner.cookie}),poisoned)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toMatchObject({items:[{id:item.id,caches:[],pending_count:0}],next_cursor:null})
  expect((await worker.fetch(appRequest('/api/me/items?after=bad',{cookie:owner.cookie}),poisoned)).status).toBe(400)
  expect((await worker.fetch(appRequest('/api/me/items'),poisoned)).status).toBe(401)
})
