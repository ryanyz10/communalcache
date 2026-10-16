import { expect,it } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { attachItem,createCache,createItem,createRequest,decideRequest,finishProfilePhoto,itemDetail,joinCache,profilePhotoKey,removeCacheMember,requestContact,requestDetail,requestsPage,saveContact } from '../src/db'
import { itemChanges } from '../src/items'
import { decisionInput } from '../src/requests'
import { contactInput } from '../src/contacts'
import { notificationContent } from '../src/notifications'
import { appRequest,login } from './helpers'
async function user(name:string){
  const id=crypto.randomUUID(),now=new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?,\'\',?,1,?,?,?)').bind(id,`${id}@auth.example.com`,now,now,name).run()
  return id
}
async function fixture(){
  const admin=await user('Admin'),owner=await user('Maya'),requester=await user('Ryan'),third=await user('Third')
  const cache=await createCache(env.DB,admin,'Tools',false)
  for(const id of [owner,requester,third])await joinCache(env.DB,cache.id,id,cache.invite_token.split('.')[1])
  const item=await createItem(env.DB,owner,itemChanges({title:'Drill',is_consumable:false},true),cache.id)
  const request=(await createRequest(env.DB,item.id,cache.id,requester,null)).request
  return {admin,owner,requester,third,cache,item,request}
}
it('returns exactly party-history fields for either party in pending/approved/declined states, never an admin or another member',async()=>{
  for(const status of ['pending','approved','rejected'] as const){
    const f=await fixture()
    if(status!=='pending')await decideRequest(env.DB,f.request.id,f.owner,status==='approved'?'approve':'reject',decisionInput(status==='approved'?{approval_message:'Private party note'}:{reason:'Not today'},status==='approved'?'approve':'reject'))
    for(const id of [f.owner,f.requester]){
      const detail=await requestDetail(env.DB,f.request.id,id),history=(await requestsPage(env.DB,id,null)).requests.find(row=>row.id===f.request.id)
      expect(detail).toEqual(history)
      expect(detail.status).toBe(status)
      expect(JSON.stringify(detail)).not.toMatch(/@auth|"email"|photo_path|creation_token|decision_token|item_quantity/)
    }
    for(const id of [f.admin,f.third,await user('Outsider')])await expect(requestDetail(env.DB,f.request.id,id)).rejects.toMatchObject({status:404})
  }
})
it('retains approved party note after removal but grants no cache/item/profile-photo/contact access',async()=>{
  const f=await fixture(),version=crypto.randomUUID()
  await finishProfilePhoto(env.DB,f.owner,`users/${f.owner}/${version}`,true)
  await saveContact(env.DB,f.owner,contactInput({kind:'email',value:'chosen@contact.example'}))
  await decideRequest(env.DB,f.request.id,f.owner,'approve',decisionInput({approval_message:'Only the two parties'},'approve'))
  expect((await requestDetail(env.DB,f.request.id,f.requester)).owner_photo_version).toBe(version)
  await removeCacheMember(env.DB,f.cache.id,f.admin,f.requester)
  const history=await requestDetail(env.DB,f.request.id,f.requester)
  expect(history).toMatchObject({status:'approved',approval_message:'Only the two parties',owner_photo_version:null})
  await expect(itemDetail(env.DB,f.item.id,f.requester,f.cache.id)).rejects.toMatchObject({status:404})
  await expect(profilePhotoKey(env.DB,f.owner,f.requester)).rejects.toMatchObject({status:404})
  await expect(requestContact(env.DB,f.request.id,f.requester)).rejects.toMatchObject({status:404})
  await expect(requestContact(env.DB,f.request.id,f.owner)).rejects.toMatchObject({status:404})
})
it('distinguishes eligible missing contact and never uses auth email; another active shared cache does not restore contact',async()=>{
  const f=await fixture(),other=await createCache(env.DB,f.third,'Other cache',false)
  for(const id of [f.owner,f.requester])await joinCache(env.DB,other.id,id,other.invite_token.split('.')[1])
  await decideRequest(env.DB,f.request.id,f.owner,'approve',decisionInput({},'approve'))
  expect(await requestContact(env.DB,f.request.id,f.requester)).toBeNull()
  await saveContact(env.DB,f.owner,contactInput({kind:'sms',value:'+15550142290'}))
  expect((await requestContact(env.DB,f.request.id,f.requester))?.kind).toBe('sms')
  await removeCacheMember(env.DB,f.cache.id,f.admin,f.requester)
  expect((await requestDetail(env.DB,f.request.id,f.requester)).status).toBe('approved')
  await expect(requestContact(env.DB,f.request.id,f.requester)).rejects.toMatchObject({status:404})
})
it('serves authenticated GET-only/no-store UUID detail and ignores forged party query parameters',async()=>{
  const caller=await login('detail-caller@auth.example.com'),f=await fixture()
  const path=`/api/me/requests/${f.request.id.toUpperCase()}`
  expect((await worker.fetch(appRequest(path),env)).status).toBe(401)
  expect((await worker.fetch(appRequest(`${path}?user_id=${f.owner}`,{cookie:caller.cookie}),env)).status).toBe(404)
  const item=await createItem(env.DB,caller.id,itemChanges({title:'Sugar',is_consumable:true,quantity:8},true),null)
  const cache=await createCache(env.DB,caller.id,'Own',false)
  await joinCache(env.DB,cache.id,f.requester,cache.invite_token.split('.')[1])
  await attachItem(env.DB,item.id,cache.id,caller.id)
  const request=(await createRequest(env.DB,item.id,cache.id,f.requester,2)).request
  const ownPath=`/api/me/requests/${request.id.toUpperCase()}`
  const response=await worker.fetch(appRequest(ownPath,{cookie:caller.cookie}),env)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toMatchObject({id:request.id,item_title:'Sugar',quantity:2,status:'pending'})
  expect((await worker.fetch(appRequest(ownPath,{method:'POST',cookie:caller.cookie,body:{}}),env)).status).toBe(405)
  expect((await worker.fetch(appRequest(ownPath+'/approve',{cookie:caller.cookie}),env)).status).toBe(405)
  expect((await worker.fetch(appRequest('/api/me/requests/not-a-uuid',{cookie:caller.cookie}),env)).status).toBe(404)
})
it('builds a validated approved-request deep link without private message/contact payloads and preserves legacy fallback',()=>{
  const requestId=crypto.randomUUID(),cacheId=crypto.randomUUID(),itemId=crypto.randomUUID()
  const payload={event:'request_approved',recipient_id:'caller',cache_id:cacheId,cache_name:'Tools',item_id:itemId,request_id:requestId,item_title:'Drill',approval_message:'private',contact:'chosen@example.com'}
  const content=notificationContent({id:'outbox',kind:'request_approved',attempts:0,payload:JSON.stringify(payload)},'https://communalcache.com')
  expect(content.path).toBe(`/requests/${requestId}`)
  expect(content.html).toContain(`https://communalcache.com/requests/${requestId}`)
  expect(JSON.stringify(content)).not.toMatch(/private|chosen@example/)
  expect(notificationContent({id:'outbox',kind:'request_approved',attempts:0,payload:JSON.stringify({...payload,request_id:'//evil.test'})},'https://communalcache.com').path).toBe(`/caches/${cacheId}/items/${itemId}`)
})
