import { afterEach, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { attachItem, createCache, createItem, createRequest, finishItemPhoto, itemDetail, joinCache, removeItemPhoto } from '../src/db'
import { sweepPhotoCleanup } from '../src/cleanup'
import { appRequest, base, login } from './helpers'

const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/f9sAAAAASUVORK5CYII='),char=>char.charCodeAt(0))
afterEach(()=>vi.restoreAllMocks())
async function profile(email:string) {
  const user=await login(email)
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:user.cookie,body:{display_name:'Neighbor'}}),env)
  return user
}
async function fixture() {
  const prefix=crypto.randomUUID()
  const owner=await profile(`${prefix}-owner@example.test`), admin=await profile(`${prefix}-admin@example.test`)
  await env.DB.prepare("UPDATE user SET plan='plus' WHERE id=?").bind(admin.id).run()
  const first=await createCache(env.DB,admin.id,'Tools',false), second=await createCache(env.DB,admin.id,'Garden',false)
  for (const cache of [first,second]) await joinCache(env.DB,cache.id,owner.id,cache.invite_token.split('.')[1])
  const item=await createItem(env.DB,owner.id,{title:'Tent',is_consumable:false},first.id)
  await attachItem(env.DB,item.id,second.id,owner.id)
  const path=`/api/me/items/${item.id}/photo`
  const response=await worker.fetch(new Request(base+path,{method:'POST',headers:{Cookie:owner.cookie,Origin:base,'Content-Type':'image/png'},body:png}),env)
  expect(response.status).toBe(200)
  const {photo_version}=await response.json() as {photo_version:string}
  const key=`${owner.id}/${item.id}/${photo_version}`
  return {owner,admin,first,second,item,path,photo_version,key}
}
const intents=()=>env.DB.prepare('SELECT owner_id,item_id,kind,target,scope FROM r2_cleanup').all()

it('clears only the owned pointer and atomically records one exact item intent, retaining item/attachments/requests and bytes until cleanup',async()=>{
  const f=await fixture()
  await createRequest(env.DB,f.item.id,f.first.id,f.admin.id,null)
  await env.DB.exec('UPDATE plan_limits SET photos_per_item=0')
  const remove=vi.spyOn(env.BUCKET,'delete')
  const response=await worker.fetch(appRequest(f.path,{method:'DELETE',cookie:f.owner.cookie,body:{photo_version:f.photo_version}}),env)
  expect(response.status).toBe(204)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await itemDetail(env.DB,f.item.id,f.owner.id)).toMatchObject({photo_version:null})
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM item_caches WHERE item_id=?').bind(f.item.id).first('n')).toBe(2)
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE item_id=? AND status='pending'").bind(f.item.id).first('n')).toBe(1)
  expect((await intents()).results).toEqual([{owner_id:f.owner.id,item_id:f.item.id,kind:'exact',target:f.key,scope:'item'}])
  expect(remove).not.toHaveBeenCalled()
  expect(await env.BUCKET.head(f.key)).not.toBeNull()
  for (const path of [f.path,...[f.first,f.second].map(cache=>`/api/caches/${cache.id}/items/${f.item.id}/photo`)]) {
    expect((await worker.fetch(appRequest(path,{cookie:path===f.path?f.owner.cookie:f.admin.cookie}),env)).status).toBe(404)
  }
  await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(f.key)).toBeNull()
  expect((await intents()).results).toEqual([])
  expect((await worker.fetch(appRequest(f.path,{method:'DELETE',cookie:f.owner.cookie,body:{photo_version:f.photo_version}}),env)).status).toBe(204)
  expect((await intents()).results).toEqual([])
})

it('denies non-owner/cache-admin removal with no cleanup and never aliases cache photo DELETE to global item deletion',async()=>{
  const f=await fixture()
  expect((await worker.fetch(appRequest(f.path,{method:'DELETE',cookie:f.admin.cookie,body:{photo_version:f.photo_version,owner_id:f.owner.id}}),env)).status).toBe(404)
  expect((await worker.fetch(appRequest(`/api/caches/${f.first.id}/items/${f.item.id}/photo`,{method:'DELETE',cookie:f.owner.cookie,body:{photo_version:f.photo_version}}),env)).status).toBe(405)
  await expect(removeItemPhoto(env.DB,f.item.id,f.admin.id,f.photo_version)).rejects.toMatchObject({status:404})
  expect((await intents()).results).toEqual([])
  expect(await itemDetail(env.DB,f.item.id,f.owner.id)).toMatchObject({photo_version:f.photo_version})
})

it('rejects a stale expected version after replacement without clearing the new pointer or adding a cleanup intent',async()=>{
  const f=await fixture(), newer=crypto.randomUUID(), key=`${f.owner.id}/${f.item.id}/${newer}`
  await env.BUCKET.put(key,png)
  expect(await finishItemPhoto(env.DB,f.item.id,f.owner.id,key,true)).toBe(true)
  const before=(await intents()).results
  expect(before).toEqual([{owner_id:f.owner.id,item_id:f.item.id,kind:'exact',target:f.key,scope:'item'}])
  const response=await worker.fetch(appRequest(f.path,{method:'DELETE',cookie:f.owner.cookie,body:{photo_version:f.photo_version}}),env)
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({error:'photo_changed'})
  expect((await intents()).results).toEqual(before)
  expect(await itemDetail(env.DB,f.item.id,f.owner.id)).toMatchObject({photo_version:newer})
})

it('rolls pointer clearing and operation token back if cleanup insertion fails',async()=>{
  const f=await fixture(), before=await env.DB.prepare('SELECT photo_path,operation_token FROM items WHERE id=?').bind(f.item.id).first()
  await env.DB.exec("CREATE TRIGGER fail_photo_remove BEFORE INSERT ON r2_cleanup BEGIN SELECT RAISE(ABORT,'injected photo removal failure'); END")
  await expect(removeItemPhoto(env.DB,f.item.id,f.owner.id,f.photo_version)).rejects.toThrow('injected photo removal failure')
  expect(await env.DB.prepare('SELECT photo_path,operation_token FROM items WHERE id=?').bind(f.item.id).first()).toEqual(before)
  expect((await intents()).results).toEqual([])
})

it('serializes removal/replacement races without deleting or scheduling cleanup for the new current photo',async()=>{
  for (const replacementFirst of [false,true]) {
    const f=await fixture(), version=crypto.randomUUID(), key=`${f.owner.id}/${f.item.id}/${version}`
    await env.BUCKET.put(key,png)
    const replace=()=>finishItemPhoto(env.DB,f.item.id,f.owner.id,key,true)
    const remove=()=>removeItemPhoto(env.DB,f.item.id,f.owner.id,f.photo_version)
    await Promise.allSettled(replacementFirst?[replace(),remove()]:[remove(),replace()])
    expect(await itemDetail(env.DB,f.item.id,f.owner.id)).toMatchObject({photo_version:version})
    expect((await intents()).results.some(row=>row.target===key)).toBe(false)
    await sweepPhotoCleanup(env)
    expect(await env.BUCKET.head(key)).not.toBeNull()
  }
})

it('enforces exact Origin and validates expected versions without affecting the pointer',async()=>{
  const f=await fixture()
  for (const origin of [null,'null','https://foreign.test']) expect((await worker.fetch(appRequest(f.path,{method:'DELETE',cookie:f.owner.cookie,origin,body:{photo_version:f.photo_version}}),env)).status).toBe(403)
  for (const photo_version of [undefined,null,'',`${f.admin.id}/wrong`,12]) {
    expect((await worker.fetch(appRequest(f.path,{method:'DELETE',cookie:f.owner.cookie,body:{photo_version}}),env)).status).toBe(400)
  }
  expect((await intents()).results).toEqual([])
  expect(await itemDetail(env.DB,f.item.id,f.owner.id)).toMatchObject({photo_version:f.photo_version})
})
