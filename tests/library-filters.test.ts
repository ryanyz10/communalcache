import { expect,it } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { attachItem,createCache,createItem,joinCache,libraryPage } from '../src/db'
import { itemChanges } from '../src/items'
import { appRequest,login } from './helpers'
async function user() {
  const id=crypto.randomUUID(),now=new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?,\'\',?,1,?,?,\'Neighbor\')').bind(id,`${id}@example.com`,now,now).run()
  return id
}
it('counts canonical owner rows once across shared caches, type filters and private rows, never first-page totals',async()=>{
  const owner=await user(),other=await user()
  const a=await createCache(env.DB,owner,'A',false),b=await createCache(env.DB,other,'B',false)
  await joinCache(env.DB,b.id,owner,b.invite_token.split('.')[1])
  const shared=await createItem(env.DB,owner,itemChanges({title:'Jars',is_consumable:true,quantity:9999},true),a.id)
  await attachItem(env.DB,shared.id,b.id,owner)
  await createItem(env.DB,owner,itemChanges({title:'Tent',is_consumable:false},true))
  await createItem(env.DB,other,itemChanges({title:'Not yours',is_consumable:false},true),b.id)
  const page=await libraryPage(env.DB,owner,null)
  expect(page.totals).toEqual({total_count:2,lend_count:1,give_count:1,unshared_count:1,shared_cache_count:2})
  expect((await libraryPage(env.DB,owner,null,'give')).items.map(item=>item.id)).toEqual([shared.id])
  expect((await libraryPage(env.DB,owner,null,'lend')).items[0].title).toBe('Tent')
  expect((await libraryPage(env.DB,owner,null,'unshared')).items[0].title).toBe('Tent')
  expect(JSON.stringify(page)).not.toMatch(/email|@example|requester_id|photo_path/)
})
it('filters and shared-cache totals recheck active membership even if an old attachment survives',async()=>{
  const admin=await user(),owner=await user(),cache=await createCache(env.DB,admin,'Private',false)
  await joinCache(env.DB,cache.id,owner,cache.invite_token.split('.')[1])
  await createItem(env.DB,owner,itemChanges({title:'Tent',is_consumable:false},true),cache.id)
  for(const status of ['pending','removed','left']) {
    await env.DB.prepare('UPDATE memberships SET status=? WHERE cache_id=? AND user_id=?').bind(status,cache.id,owner).run()
    const page=await libraryPage(env.DB,owner,null,'unshared')
    expect(page.items).toHaveLength(1)
    expect(page.items[0].caches).toEqual([])
    expect(page.totals).toMatchObject({unshared_count:1,shared_cache_count:0})
  }
})
it('paginates within each owner-filtered scope with exact totals beyond 25 and stable equal-time cursors',async()=>{
  const owner=await user(),other=await user()
  const statements=Array.from({length:58},(_,n)=>env.DB.prepare('INSERT INTO items(id,owner_id,title,is_consumable,quantity,created_at) VALUES (?,?,?,?,?,100)').bind(crypto.randomUUID(),owner,`Item ${n}`,n%2,n%2?8:null))
  await env.DB.batch(statements)
  await createItem(env.DB,other,itemChanges({title:'Other owner',is_consumable:true,quantity:2},true))
  for(const filter of ['lend','give','unshared']) {
    const first=await libraryPage(env.DB,owner,null,filter)
    expect(first.items).toHaveLength(25)
    expect(first.totals).toEqual({total_count:58,lend_count:29,give_count:29,unshared_count:58,shared_cache_count:0})
    const second=await libraryPage(env.DB,owner,first.next_cursor,filter)
    expect(new Set([...first.items,...second.items].map(item=>item.id)).size).toBe(first.items.length+second.items.length)
    expect(second.items.every(item=>item.owner_id===owner)).toBe(true)
    if(filter!=='unshared') {expect(second.items).toHaveLength(4);expect(second.next_cursor).toBeNull()}
  }
})
it('keeps filter inputs validated and HTTP pagination/aggregates caller-only despite forged identities',async()=>{
  const caller=await login('library-filters@example.com'),other=await user()
  await createItem(env.DB,other,itemChanges({title:'Secret',is_consumable:false},true))
  for(const filter of ['bogus','','GIVE']) await expect(libraryPage(env.DB,caller.id,null,filter)).rejects.toMatchObject({status:400,code:'invalid_filter'})
  const response=await worker.fetch(appRequest(`/api/me/items?filter=unshared&owner_id=${other}`,{cookie:caller.cookie}),env)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toMatchObject({items:[],totals:{total_count:0,shared_cache_count:0}})
  expect((await worker.fetch(appRequest('/api/me/items?filter=bad',{cookie:caller.cookie}),env)).status).toBe(400)
  expect((await worker.fetch(appRequest('/api/me/items?filter=give'),env)).status).toBe(401)
})
