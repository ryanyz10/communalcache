import { expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, reset, type D1Migration } from 'cloudflare:test'
import { attachItem, claimOutbox, consumeWriteLimit, createCache, createItem, createRequest, finishItemPhoto, itemDetail, joinCache, libraryPage, savePush } from '../src/db'
import { itemChanges } from '../src/items'
import { login } from './helpers'

it('drops only obsolete projections on a populated upgrade, preserving canonical/auth/durable state and private photos', async () => {
  const migrations = (env as unknown as {TEST_MIGRATIONS:D1Migration[]}).TEST_MIGRATIONS
  const retirement = migrations.find(row => row.name.includes('retire_cache_projections'))!
  await reset()
  await applyD1Migrations(env.DB,migrations.filter(row => row !== retirement))
  const owner = await login('owner@example.test'), neighbor = await login('neighbor@example.test')
  await env.DB.prepare("UPDATE user SET plan='plus' WHERE id=?").bind(owner.id).run()
  const a = await createCache(env.DB,owner.id,'Tools',false), b = await createCache(env.DB,owner.id,'Garden',false)
  await joinCache(env.DB,a.id,neighbor.id,a.invite_token.split('.')[1])
  const item = await createItem(env.DB,owner.id,itemChanges({title:'Seeds',is_consumable:true,quantity:8},true),a.id)
  await attachItem(env.DB,item.id,b.id,owner.id)
  const request = await createRequest(env.DB,item.id,a.id,neighbor.id,2)
  await claimOutbox(env.DB,request.notificationId,'preserved-claim',Date.now())
  const key = `${owner.id}/${item.id}/${crypto.randomUUID()}`, orphan = `${owner.id}/${item.id}/${crypto.randomUUID()}`
  await env.BUCKET.put(key,'private photo')
  expect(await finishItemPhoto(env.DB,item.id,owner.id,key,true)).toBe(true)
  await env.DB.prepare("INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at,claim_token,claim_until) VALUES (?,?,?,'exact',?,1,'cleanup-claim',9999999999999)").bind(crypto.randomUUID(),owner.id,item.id,orphan).run()
  await savePush(env.DB,owner.id,{endpoint:'https://fcm.googleapis.com/fixture',p256dh:'public-fixture',auth:'fixture-only'})
  await consumeWriteLimit(env.DB,owner.id,'join',Date.now(),10)
  await env.DB.prepare('UPDATE notification_sync_cursor SET outbox_id=?').bind(request.notificationId).run()
  await env.DB.prepare('INSERT INTO my_caches(user_id,cache_id) VALUES (?,?)').bind(owner.id,a.id).run()
  await env.DB.prepare('UPDATE cache_sync_cursor SET cache_id=?').bind(a.id).run()
  const tables = ['user','session','account','verification','rateLimit','caches','memberships','items','item_caches','requests','outbox','push_subscriptions','write_limits','notification_sync_cursor','r2_cleanup','r2_cleanup_cursor']
  const before = new Map<string,unknown[]>()
  for (const table of tables) before.set(table,(await env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results)
  await applyD1Migrations(env.DB,[retirement])
  await applyD1Migrations(env.DB,[retirement])
  for (const table of tables) expect((await env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results).toEqual(before.get(table))
  const names = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{name:string}>()).results.map(row => row.name)
  for (const table of ['my_caches','cache_sync_cursor']) expect(names).not.toContain(table)
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  expect(await itemDetail(env.DB,item.id,owner.id)).toMatchObject({quantity:8,available_quantity:6,pending_count:1,caches:expect.arrayContaining([{id:a.id,name:'Tools'},{id:b.id,name:'Garden'}])})
  expect((await libraryPage(env.DB,neighbor.id,null)).items).toEqual([])
  expect(await env.BUCKET.head(key)).not.toBeNull()
  await expect(env.DB.prepare('UPDATE items SET quantity=-1 WHERE id=?').bind(item.id).run()).rejects.toThrow()
  await expect(env.DB.prepare("UPDATE requests SET status='approved' WHERE id=?").bind(request.request.id).run()).rejects.toThrow()
  expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name='verification_sign_in_otp_identifier_unique'").first('name')).toBeTruthy()
})
