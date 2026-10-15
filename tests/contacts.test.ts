import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, reset, type D1Migration } from 'cloudflare:test'
import worker from '../src/index'
import { contactInput } from '../src/contacts'
import { attachItem, cacheDetail, cacheItems, createCache, createItem, createRequest, decideRequest, itemRequests, joinCache, ownContact, removeCacheMember, removeContact, requestContact, requestsPage, saveContact } from '../src/db'
import { itemChanges } from '../src/items'
import { decisionInput } from '../src/requests'
import { appRequest, login } from './helpers'

async function user(name: string) {
  const id = crypto.randomUUID(), now = new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?,?,?,1,?,?,?)').bind(id,'',`${id}@auth.example.test`,now,now,name).run()
  return id
}
async function fixture() {
  const admin = await user('Admin'), owner = await user('Owner'), requester = await user('Requester'), third = await user('Third')
  await env.DB.prepare("UPDATE user SET plan='plus' WHERE id=?").bind(admin).run()
  const cache = await createCache(env.DB,admin,'Tools',false), other = await createCache(env.DB,admin,'Other cache',false)
  for (const c of [cache,other]) for (const id of [owner,requester,third]) await joinCache(env.DB,c.id,id,c.invite_token.split('.')[1])
  const item = await createItem(env.DB,owner,itemChanges({title:'Mixer',is_consumable:false},true),cache.id)
  await attachItem(env.DB,item.id,other.id,owner)
  const request = (await createRequest(env.DB,item.id,cache.id,requester,null)).request
  await saveContact(env.DB,owner,contactInput({kind:'email',value:'chosen@contact.example'}))
  await saveContact(env.DB,requester,contactInput({kind:'signal',value:'+14155550148'}))
  return {admin,owner,requester,third,cache,other,item,request}
}
async function approve(f: Awaited<ReturnType<typeof fixture>>, message = '') {
  return decideRequest(env.DB,f.request.id,f.owner,'approve',decisionInput({approval_message:message},'approve'))
}

it.each([
  ['sms','14155550148','+14155550148','sms:+14155550148'],
  ['whatsapp','+14155550148','+14155550148','https://wa.me/14155550148'],
  ['signal','+14155550148','+14155550148','https://signal.me/#p/+14155550148'],
  ['messenger','ryan.zhou','ryan.zhou','https://m.me/ryan.zhou'],
  ['instagram','ryan_zhou','ryan_zhou','https://instagram.com/ryan_zhou'],
  ['email','chosen+cache@example.test','chosen+cache@example.test','mailto:chosen%2Bcache@example.test'],
])('validates and builds the exact %s destination, ignoring a body-supplied URL', (kind,input,value,link) => {
  expect(contactInput({kind,value:` ${input} `,link:'javascript:alert(1)'})).toEqual({kind,value,link})
})

it('rejects unsupported kinds, URLs, injected schemes, malformed values, controls and URI/header injection', () => {
  for (const kind of ['sms','whatsapp','signal','messenger','instagram','email','url']) {
    for (const value of ['javascript:alert(1)','data:text/html,test','https://m.me/ryan','//evil.test','user@host?subject=x','test@example.test?bcc=x','x@example.test\r\nBcc:x','x%0a@example.test','x@example.test#x','x@example.test&bcc=y','x\u0000@example.test']) expect(()=>contactInput({kind,value})).toThrow('invalid_contact')
  }
  for (const kind of ['sms','whatsapp','signal']) {
    for (const value of ['123456','1'.repeat(16),'++14155550148','+1 4155550148','+1415-555-0148','١٤١٥٥٥٥٠١٤٨']) expect(()=>contactInput({kind,value})).toThrow('invalid_contact')
    for (const value of ['1'.repeat(7),'1'.repeat(15)]) expect(contactInput({kind,value}).value).toBe(`+${value}`)
  }
  for (const value of ['abcd','a'.repeat(51),'.ryan','ryan.','ry..an','ry/an','ryan?x','ryan@home']) expect(()=>contactInput({kind:'messenger',value})).toThrow('invalid_contact')
  for (const value of ['a'.repeat(31),'a/b','..a','a..b','@ryan','ryan.','r😀']) expect(()=>contactInput({kind:'instagram',value})).toThrow('invalid_contact')
  for (const value of ['a'.repeat(65)+'@example.test','a@example','a@-example.test','a@example..test','.a@example.test','a..b@example.test','a@example.test:443','a@user@host.test','a'.repeat(255)]) expect(()=>contactInput({kind:'email',value})).toThrow('invalid_contact')
  for (const value of [null,123,{},'']) expect(()=>contactInput({kind:'email',value})).toThrow('invalid_contact')
})

it('upgrades populated request rows additively without copying auth emails, and constrains contact/message storage', async () => {
  const migrations = (env as unknown as {TEST_MIGRATIONS:D1Migration[]}).TEST_MIGRATIONS, migration = migrations.find(row=>row.name.includes('0014'))!
  await reset(); await applyD1Migrations(env.DB,migrations.filter(row=>row!==migration))
  const owner = await user('Owner'), requester = await user('Requester'), cache = await createCache(env.DB,owner,'Tools',false)
  await joinCache(env.DB,cache.id,requester,cache.invite_token.split('.')[1])
  const item = await createItem(env.DB,owner,itemChanges({title:'Mixer',is_consumable:false},true),cache.id), id = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO requests(id,item_id,cache_id,requester_id,status,created_at,creation_token) VALUES (?,?,?,?,'pending',1,?)").bind(id,item.id,cache.id,requester,crypto.randomUUID()).run()
  await applyD1Migrations(env.DB,[migration])
  expect(await env.DB.prepare('SELECT status,approval_message FROM requests WHERE id=?').bind(id).first()).toEqual({status:'pending',approval_message:null})
  expect(await ownContact(env.DB,owner)).toBeNull()
  await expect(env.DB.prepare("INSERT INTO user_contacts VALUES (?,'url','javascript:bad')").bind(owner).run()).rejects.toThrow()
  await expect(env.DB.prepare("INSERT INTO user_contacts VALUES (?,'sms','1234567')").bind(crypto.randomUUID()).run()).rejects.toThrow()
  await expect(env.DB.prepare("UPDATE requests SET approval_message='not approved' WHERE id=?").bind(id).run()).rejects.toThrow()
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
})

it('reveals only the other approved party in one SQL statement; pending, rejected, admin and third member get no contact', async () => {
  const f = await fixture()
  for (const id of [f.owner,f.requester,f.admin,f.third]) await expect(requestContact(env.DB,f.request.id,id)).rejects.toMatchObject({status:404})
  await approve(f)
  const prepare = vi.spyOn(env.DB,'prepare')
  expect(await requestContact(env.DB,f.request.id,f.requester)).toEqual(contactInput({kind:'email',value:'chosen@contact.example'}))
  expect(prepare).toHaveBeenCalledTimes(1)
  const sql = prepare.mock.calls[0][0]
  for (const guard of ["r.status='approved'","requester.status='active'","owner.status='active'",'requester.cache_id=r.cache_id','owner.cache_id=r.cache_id']) expect(sql).toContain(guard)
  expect(sql).not.toMatch(/\bemail\b|JOIN user\b/)
  prepare.mockRestore()
  expect(await requestContact(env.DB,f.request.id,f.owner)).toEqual(contactInput({kind:'signal',value:'+14155550148'}))
  for (const id of [f.admin,f.third]) await expect(requestContact(env.DB,f.request.id,id)).rejects.toMatchObject({status:404})
  const rejected = (await createRequest(env.DB,f.item.id,f.cache.id,f.requester,null)).request
  await decideRequest(env.DB,rejected.id,f.owner,'reject',decisionInput({reason:'Not today'},'reject'))
  for (const id of [f.owner,f.requester]) await expect(requestContact(env.DB,rejected.id,id)).rejects.toMatchObject({status:404})
})

for (const party of ['requester','owner'] as const) for (const status of ['pending','left','removed']) {
  it(`denies both directions when ${party} is ${status}, even with another shared active cache and retained history`, async () => {
    const f = await fixture(); await approve(f,'Private note')
    await env.DB.prepare('UPDATE memberships SET status=? WHERE cache_id=? AND user_id=?').bind(status,f.cache.id,f[party]).run()
    for (const id of [f.owner,f.requester]) {
      await expect(requestContact(env.DB,f.request.id,id)).rejects.toMatchObject({status:404})
      expect((await requestsPage(env.DB,id,null)).requests[0].approval_message).toBe('Private note')
    }
  })
}

it('rechecks leave/removal and replacement races on the next read, distinguishes missing contact and supports self-only removal', async () => {
  for (const leaving of [false,true]) {
    const f = await fixture(); await approve(f)
    const results = await Promise.allSettled([requestContact(env.DB,f.request.id,f.requester),removeCacheMember(env.DB,f.cache.id,leaving ? f.requester : f.admin,f.requester,leaving)])
    expect(results[1].status).toBe('fulfilled')
    await expect(requestContact(env.DB,f.request.id,f.requester)).rejects.toMatchObject({status:404})
    expect(await ownContact(env.DB,f.owner)).not.toBeNull()
  }
  const f = await fixture(); await approve(f)
  const replacement = contactInput({kind:'instagram',value:'new.username'})
  const [read] = await Promise.all([requestContact(env.DB,f.request.id,f.requester),saveContact(env.DB,f.owner,replacement)])
  expect([contactInput({kind:'email',value:'chosen@contact.example'}),replacement]).toContainEqual(read)
  expect(await requestContact(env.DB,f.request.id,f.requester)).toEqual(replacement)
  await removeContact(env.DB,f.owner)
  expect(await requestContact(env.DB,f.request.id,f.requester)).toBeNull()
  expect(await ownContact(env.DB,f.requester)).not.toBeNull()
})

it('stores an empty-default approval message atomically with the decision, checks 500 Unicode code points, and excludes messages/contacts from outbox and nonparties', async () => {
  expect(decisionInput({},'approve').approval_message).toBeUndefined()
  expect(decisionInput({approval_message:'  '},'approve').approval_message).toBeNull()
  for (const value of [null,123,'😀'.repeat(501),'x\u0000y']) expect(()=>decisionInput({approval_message:value},'approve')).toThrow('invalid_approval_message')
  const f = await fixture(), message = '😀'.repeat(500)
  await env.DB.exec("CREATE TRIGGER fail_contact_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'injected'); END")
  await expect(approve(f,message)).rejects.toThrow('injected')
  expect(await env.DB.prepare('SELECT status,approval_message FROM requests WHERE id=?').bind(f.request.id).first()).toEqual({status:'pending',approval_message:null})
  await env.DB.exec('DROP TRIGGER fail_contact_outbox')
  const result = await approve(f,message)
  expect(result.request.approval_message).toBe(message)
  await expect(approve(f,'Overwrite')).rejects.toMatchObject({status:409})
  expect((await requestsPage(env.DB,f.requester,null)).requests[0].approval_message).toBe(message)
  expect(await itemRequests(env.DB,f.item.id,f.cache.id,f.third)).toEqual([])
  for (const payload of [await requestsPage(env.DB,f.third,null),await cacheDetail(env.DB,f.cache.id,f.third),await cacheItems(env.DB,f.cache.id,f.third),(await env.DB.prepare('SELECT payload FROM outbox').all()).results]) {
    for (const forbidden of [message,'chosen@contact.example','14155550148','auth.example.test']) expect(JSON.stringify(payload)).not.toContain(forbidden)
  }
})

it('protects Worker own contact/preview/reveal with session, profile, Origin and exact paths; never enriches auth or lists with contact/auth email', async () => {
  const owner = await login('private-owner@auth.example.test'), requester = await login('private-requester@auth.example.test')
  for (const caller of [owner,requester]) await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:caller.cookie,body:{display_name:'Neighbor'}}),env)
  for (const path of ['/api/me/contact','/api/me/contact/preview']) {
    const method = path.endsWith('preview') ? 'POST' : 'PUT'
    expect((await worker.fetch(appRequest(path,{method,body:{kind:'email',value:'chosen@contact.example'}}),env)).status).toBe(401)
    for (const origin of [null,'null','https://evil.test']) expect((await worker.fetch(appRequest(path,{method,cookie:owner.cookie,origin,body:{kind:'email',value:'chosen@contact.example'}}),env)).status).toBe(403)
  }
  const preview = await worker.fetch(appRequest('/api/me/contact/preview',{method:'POST',cookie:owner.cookie,body:{kind:'email',value:'chosen@contact.example'}}),env)
  expect(await preview.json()).toEqual({contact:contactInput({kind:'email',value:'chosen@contact.example'})})
  expect(await ownContact(env.DB,owner.id)).toBeNull()
  expect((await worker.fetch(appRequest('/api/me/contact',{method:'PUT',cookie:owner.cookie,body:{kind:'email',value:'chosen@contact.example',user_id:requester.id,link:'javascript:bad'}}),env)).status).toBe(200)
  expect(await ownContact(env.DB,requester.id)).toBeNull()
  const cache = await createCache(env.DB,owner.id,'Tools',false)
  await joinCache(env.DB,cache.id,requester.id,cache.invite_token.split('.')[1])
  const item = await createItem(env.DB,owner.id,itemChanges({title:'Mixer',is_consumable:false},true),cache.id), request = (await createRequest(env.DB,item.id,cache.id,requester.id,null)).request
  const path = `/api/me/requests/${request.id.toUpperCase()}/contact`
  expect((await worker.fetch(appRequest(path,{cookie:requester.cookie}),env)).status).toBe(404)
  const decision = `/api/me/requests/${request.id}/approve`
  expect((await worker.fetch(appRequest(decision,{method:'POST',cookie:owner.cookie,body:{approval_message:'😀'.repeat(501)}}),env)).status).toBe(400)
  expect((await worker.fetch(appRequest(decision,{method:'POST',cookie:owner.cookie,body:{approval_message:'By the gate'}}),env)).status).toBe(200)
  const revealed = await worker.fetch(appRequest(path,{cookie:requester.cookie}),env)
  expect(revealed.headers.get('Cache-Control')).toContain('no-store')
  expect(await revealed.json()).toEqual({contact:contactInput({kind:'email',value:'chosen@contact.example'})})
  expect((await worker.fetch(appRequest(path),env)).status).toBe(401)
  expect((await worker.fetch(appRequest(`/api/users/${owner.id}/contact`,{cookie:requester.cookie}),env)).status).toBe(404)
  for (const route of ['/api/requests',`/api/caches/${cache.id}`,`/api/caches/${cache.id}/items`, `/api/caches/${cache.id}/items/${item.id}/requests`,'/api/auth/get-session','/api/me']) {
    const response = await worker.fetch(appRequest(route,{cookie:requester.cookie}),env)
    expect(response.status).toBe(200)
    const text = await response.text()
    for (const hidden of ['private-owner@auth.example.test','chosen@contact.example','mailto:']) expect(text).not.toContain(hidden)
  }
  expect((await worker.fetch(appRequest('/api/me/contact',{method:'DELETE',cookie:requester.cookie}),env)).status).toBe(204)
  expect(await ownContact(env.DB,owner.id)).not.toBeNull()
  await removeCacheMember(env.DB,cache.id,requester.id,requester.id,true)
  expect((await worker.fetch(appRequest(path,{cookie:requester.cookie}),env)).status).toBe(404)
})
