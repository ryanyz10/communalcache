import { expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, reset, type D1Migration } from 'cloudflare:test'
import worker from '../src/index'
import { cacheDetail, cacheJoinRequests, cacheItems, createCache, createItem, createRequest, getProfile, itemDetail, joinCache, libraryPage, requestsPage, updateCache, updateProfile } from '../src/db'
import { CAT_COATS } from '../shared/cat-coats'
import { appRequest, login } from './helpers'

async function user(name = 'Neighbor') {
  const id = crypto.randomUUID(), now = new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?,?,?,1,?,?,?)')
    .bind(id,'',`${id}@private.example.test`,now,now,name).run()
  return id
}

it('adds a nullable constrained coat on populated local D1 without changing auth or canonical rows', async () => {
  const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS
  const migration = migrations.find(row => row.name.includes('0015_cat_coat'))!
  await reset()
  await applyD1Migrations(env.DB,migrations.filter(row => row !== migration))
  const id = await user('Existing')
  await applyD1Migrations(env.DB,[migration])
  await applyD1Migrations(env.DB,[migration])
  expect(await env.DB.prepare('SELECT display_name,plan,cat_coat FROM user WHERE id=?').bind(id).first()).toEqual({ display_name:'Existing',plan:'free',cat_coat:null })
  for (const coat of CAT_COATS) {
    await env.DB.prepare('UPDATE user SET cat_coat=? WHERE id=?').bind(coat,id).run()
    expect((await getProfile(env.DB,id))?.cat_coat).toBe(coat)
  }
  for (const coat of ['purple','Grey','',0]) await expect(env.DB.prepare('UPDATE user SET cat_coat=? WHERE id=?').bind(coat,id).run()).rejects.toThrow('CHECK')
  await env.DB.prepare('UPDATE user SET cat_coat=NULL WHERE id=?').bind(id).run()
  expect((await getProfile(env.DB,id))?.cat_coat).toBeNull()
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
})

it('permits coat-only setup, atomically saves name plus coat, and resets only the caller to the hashed default', async () => {
  const caller = await login(), other = await user('Other')
  const patch = (body: unknown) => worker.fetch(appRequest('/api/me',{ method:'PATCH',cookie:caller.cookie,body }),env)
  expect(await (await patch({ cat_coat:'grey',id:other,user_id:other,email:'forged@example.test' })).json()).toMatchObject({ id:caller.id,email:'caller@example.test',display_name:null,cat_coat:'grey' })
  expect((await getProfile(env.DB,other))?.cat_coat).toBeNull()
  expect((await worker.fetch(appRequest('/api/caches',{ method:'POST',cookie:caller.cookie,body:{name:'Blocked'} }),env)).status).toBe(409)
  expect(await (await patch({ display_name:'  Mia  ',cat_coat:'toffee' })).json()).toMatchObject({ display_name:'Mia',cat_coat:'toffee' })
  expect(await (await patch({ display_name:'Mia renamed' })).json()).toMatchObject({ display_name:'Mia renamed',cat_coat:'toffee' })
  expect(await (await patch({ cat_coat:null })).json()).toMatchObject({ display_name:'Mia renamed',cat_coat:null })
  expect((await worker.fetch(appRequest(`/api/users/${other}`,{ method:'PATCH',cookie:caller.cookie,body:{cat_coat:'grey'} }),env)).status).toBe(404)
})

it('rejects invalid coat values before changing either profile field and keeps Origin/session guards', async () => {
  const caller = await login()
  await updateProfile(env.DB,caller.id,{display_name:'Original',cat_coat:'oat'})
  for (const cat_coat of ['purple','Grey',' grey','',1,false,{},[]]) {
    const response = await worker.fetch(appRequest('/api/me',{ method:'PATCH',cookie:caller.cookie,body:{display_name:'Must not save',cat_coat} }),env)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({error:'invalid_cat_coat'})
    expect(await getProfile(env.DB,caller.id)).toMatchObject({display_name:'Original',cat_coat:'oat'})
  }
  for (const origin of [null,'null','https://foreign.test']) expect((await worker.fetch(appRequest('/api/me',{ method:'PATCH',cookie:caller.cookie,origin,body:{cat_coat:'grey'} }),env)).status).toBe(403)
  expect((await worker.fetch(appRequest('/api/me',{ method:'PATCH',body:{cat_coat:'grey'} }),env)).status).toBe(401)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first('n')).toBe(0)
})

it('enriches only already-authorized display rows with coats, never auth emails or pre-join cache data', async () => {
  const owner = await login('owner@example.test'), member = await login('member@example.test'), applicant = await user()
  await updateProfile(env.DB,owner.id,{display_name:'Owner',cat_coat:'grey'})
  await updateProfile(env.DB,member.id,{display_name:'Member',cat_coat:'ginger'})
  await updateProfile(env.DB,applicant,{cat_coat:'dusk'})
  const cache = await createCache(env.DB,owner.id,'Tools',false)
  const path = `/api/caches/${cache.id}`
  expect((await worker.fetch(appRequest(path,{cookie:member.cookie}),env)).status).toBe(404)
  await joinCache(env.DB,cache.id,member.id,cache.invite_token.split('.')[1])
  const item = await createItem(env.DB,owner.id,{title:'Mixer',is_consumable:false,quantity:null},cache.id)
  await updateCache(env.DB,cache.id,owner.id,{requires_approval:true})
  await joinCache(env.DB,cache.id,applicant,cache.invite_token.split('.')[1])
  const request = await createRequest(env.DB,item.id,cache.id,member.id,null)
  const views = [
    await cacheDetail(env.DB,cache.id,owner.id),await cacheJoinRequests(env.DB,cache.id,owner.id),
    await cacheItems(env.DB,cache.id,member.id),await itemDetail(env.DB,item.id,member.id,cache.id),
    await libraryPage(env.DB,owner.id,null),await requestsPage(env.DB,owner.id,null),request.request,
  ]
  for (const view of views) expect(JSON.stringify(view)).not.toMatch(/"email"\s*:|@private|owner@example|member@example/)
  expect((views[0] as Awaited<ReturnType<typeof cacheDetail>>).members).toEqual(expect.arrayContaining([expect.objectContaining({user_id:member.id,cat_coat:'ginger'})]))
  expect(views[1]).toEqual([expect.objectContaining({user_id:applicant,cat_coat:'dusk'})])
  expect(views[3]).toMatchObject({owner_cat_coat:'grey'})
  expect(request.request).toMatchObject({owner_cat_coat:'grey',requester_cat_coat:'ginger'})
  await env.DB.prepare("UPDATE memberships SET status='removed' WHERE cache_id=? AND user_id=?").bind(cache.id,member.id).run()
  expect((await worker.fetch(appRequest(path,{cookie:member.cookie}),env)).status).toBe(404)
  expect((await worker.fetch(appRequest(`${path}/items/${item.id}`,{cookie:member.cookie}),env)).status).toBe(404)
})
