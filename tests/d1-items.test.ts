import { expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import worker from '../src/index'
import { attachItem, cacheItems, createCache, createItem, itemDetail, joinCache, libraryItems, updateItem } from '../src/db'
import { itemChanges } from '../src/items'
import { appRequest, login } from './helpers'

async function user(name = 'Neighbor') {
  const id = crypto.randomUUID(), now = new Date().toISOString()
  await env.DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,display_name) VALUES (?,?,?,1,?,?,?)').bind(id,'',`${id}@example.test`,now,now,name).run()
  return id
}
async function fixture() {
  const admin = await user('Cache admin'), owner = await user('Item owner'), member = await user(), outsider = await user()
  const first = await createCache(env.DB, admin, 'Tools', false), second = await createCache(env.DB, admin, 'Pantry', false)
  for (const cache of [first, second]) await joinCache(env.DB, cache.id, owner, cache.invite_token.split('.')[1])
  await joinCache(env.DB, first.id, member, first.invite_token.split('.')[1])
  const item = await createItem(env.DB, owner, itemChanges({ title: 'Sugar', is_consumable: true, quantity: 5 }, true), first.id)
  return { admin, owner, member, outsider, first, second, item }
}

it('adds item/attachment/cleanup tables without dropping canonical caches, membership or auth constraints', async () => {
  const owner = await user(), cache = await createCache(env.DB,owner,'Tools',false)
  const migrations = (env as unknown as {TEST_MIGRATIONS:D1Migration[]}).TEST_MIGRATIONS
  const migration = migrations.find(row=>row.name.includes('d1_items'))!
  await env.DB.exec('DROP TABLE r2_cleanup_cursor; DROP TABLE r2_cleanup; DROP TABLE item_caches; DROP TABLE items')
  await env.DB.prepare('DELETE FROM d1_migrations WHERE name=?').bind(migration.name).run()
  await applyD1Migrations(env.DB,[migration])
  expect(await env.DB.prepare('SELECT join_secret FROM caches WHERE id=?').bind(cache.id).first('join_secret')).toBe(cache.invite_token.split('.')[1])
  expect(await env.DB.prepare('SELECT status FROM memberships WHERE cache_id=? AND user_id=?').bind(cache.id,owner).first('status')).toBe('active')
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM items').first('n')).toBe(0)
  expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name='verification_sign_in_otp_identifier_unique'").first('name')).toBeTruthy()
})

it('creates one canonical item, shares it to two caches, and edits once without copying display or stock', async () => {
  const f = await fixture()
  await Promise.all([attachItem(env.DB, f.item.id, f.second.id, f.owner), attachItem(env.DB, f.item.id, f.second.id, f.owner)])
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM items').first('n')).toBe(1)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM item_caches').first('n')).toBe(2)
  await Promise.all([
    updateItem(env.DB, f.item.id, f.owner, itemChanges({ title: 'Brown sugar' }, false), f.first.id),
    updateItem(env.DB, f.item.id, f.owner, itemChanges({ quantity: 8 }, false)),
  ])
  for (const cache of [f.first, f.second]) expect(await itemDetail(env.DB, f.item.id, f.admin, cache.id)).toMatchObject({ title: 'Brown sugar', quantity: 8, cache_id: cache.id, owner_name: 'Item owner' })
  expect(await libraryItems(env.DB, f.owner)).toMatchObject([{ id: f.item.id, cache_id: null, title: 'Brown sugar', quantity: 8 }])
  expect(await libraryItems(env.DB, f.admin)).toEqual([])
})

it('keeps unshared library items private and permits canonical editing without any cache membership', async () => {
  const owner = await user(), other = await user()
  const item = await createItem(env.DB, owner, itemChanges({ title: 'Mixer', is_consumable: false }, true))
  expect(item).toMatchObject({ owner_id: owner, quantity: null, cache_id: null, available: true, unavailable_note: null })
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM item_caches').first('n')).toBe(0)
  await expect(itemDetail(env.DB, item.id, other)).rejects.toMatchObject({ status: 404 })
  expect((await updateItem(env.DB, item.id, owner, itemChanges({ title: 'Stand mixer' }, false))).title).toBe('Stand mixer')
})

it('checks caller and item-owner active membership plus attachment for every cache item read', async () => {
  const f = await fixture()
  for (const caller of [f.owner, f.member, f.admin]) expect((await itemDetail(env.DB, f.item.id, caller, f.first.id)).id).toBe(f.item.id)
  for (const caller of [f.outsider]) {
    await expect(itemDetail(env.DB, f.item.id, caller, f.first.id)).rejects.toMatchObject({ status: 404 })
    await expect(cacheItems(env.DB, f.first.id, caller)).rejects.toMatchObject({ status: 404 })
  }
  await expect(itemDetail(env.DB, f.item.id, f.admin, f.second.id)).rejects.toMatchObject({ status: 404 })
  await attachItem(env.DB, f.item.id, f.second.id, f.owner)
  for (const status of ['pending', 'removed']) {
    await env.DB.prepare('UPDATE memberships SET status=? WHERE cache_id=? AND user_id=?').bind(status,f.first.id,f.member).run()
    await expect(itemDetail(env.DB, f.item.id, f.member, f.first.id)).rejects.toMatchObject({ status: 404 })
    await expect(cacheItems(env.DB, f.first.id, f.member)).rejects.toMatchObject({ status: 404 })
  }
  await env.DB.prepare("UPDATE memberships SET status='removed' WHERE cache_id=? AND user_id=?").bind(f.first.id,f.owner).run()
  await expect(itemDetail(env.DB, f.item.id, f.admin, f.first.id)).rejects.toMatchObject({ status: 404 })
  expect(await cacheItems(env.DB, f.first.id, f.admin)).toEqual([])
  expect((await itemDetail(env.DB, f.item.id, f.owner)).id).toBe(f.item.id)
  expect((await itemDetail(env.DB, f.item.id, f.admin, f.second.id)).id).toBe(f.item.id)
})

it('guards attachment ownership/current membership in the INSERT, including idempotent retries after removal', async () => {
  const f = await fixture()
  for (const caller of [f.admin, f.member, f.outsider]) await expect(attachItem(env.DB, f.item.id, f.second.id, caller)).rejects.toMatchObject({ status: 404 })
  const third = await createCache(env.DB, f.admin, 'Other cache', false)
  await expect(attachItem(env.DB, f.item.id, third.id, f.owner)).rejects.toMatchObject({ status: 404 })
  await attachItem(env.DB, f.item.id, f.second.id, f.owner)
  await env.DB.prepare("UPDATE memberships SET status='removed' WHERE cache_id=? AND user_id=?").bind(f.second.id,f.owner).run()
  await expect(attachItem(env.DB, f.item.id, f.second.id, f.owner)).rejects.toMatchObject({ status: 404 })
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM item_caches WHERE cache_id=?').bind(third.id).first('n')).toBe(0)
})

it('orders attach/removal races through D1 guards without treating an old attachment as permission', async () => {
  for (const removeFirst of [false, true]) {
    const f = await fixture()
    const attach = () => attachItem(env.DB, f.item.id, f.second.id, f.owner)
    const remove = () => env.DB.prepare("UPDATE memberships SET status='removed' WHERE cache_id=? AND user_id=?").bind(f.second.id,f.owner).run()
    const results = await Promise.allSettled(removeFirst ? [remove(), attach()] : [attach(), remove()])
    expect(results[removeFirst ? 0 : 1].status).toBe('fulfilled')
    await expect(itemDetail(env.DB, f.item.id, f.admin, f.second.id)).rejects.toMatchObject({ status: 404 })
    expect((await itemDetail(env.DB, f.item.id, f.owner)).id).toBe(f.item.id)
  }
})

it('rolls atomic cache creation-plus-attachment back on dependent failure and has no orphan on a failed primary guard', async () => {
  const f = await fixture(), before = await env.DB.prepare('SELECT COUNT(*) AS n FROM items').first('n')
  const changes = itemChanges({ title: 'Mixer', is_consumable: false }, true)
  await expect(createItem(env.DB, f.outsider, changes, f.first.id)).rejects.toMatchObject({ status: 404 })
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM items').first('n')).toBe(before)
  await env.DB.exec("CREATE TRIGGER fail_attach BEFORE INSERT ON item_caches BEGIN SELECT RAISE(ABORT,'injected attachment failure'); END")
  await expect(createItem(env.DB, f.owner, changes, f.first.id)).rejects.toThrow('injected attachment failure')
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM items').first('n')).toBe(before)
})

it('enforces real SQLite item quantity/boolean/FK constraints and keeps type immutable on PATCH', async () => {
  const f = await fixture()
  for (const quantity of [-1,10000,1.5,null]) await expect(env.DB.prepare('UPDATE items SET quantity=? WHERE id=?').bind(quantity,f.item.id).run()).rejects.toThrow()
  await expect(env.DB.prepare('UPDATE items SET available=2 WHERE id=?').bind(f.item.id).run()).rejects.toThrow()
  await expect(env.DB.prepare('INSERT INTO item_caches(item_id,cache_id,attached_at) VALUES (?,?,1)').bind(crypto.randomUUID(),f.first.id).run()).rejects.toThrow()
  expect(() => itemChanges({ is_consumable: false }, false)).toThrow('immutable_is_consumable')
  await expect(updateItem(env.DB, f.item.id, f.owner, itemChanges({ quantity: null }, false))).rejects.toMatchObject({ status: 400, code: 'invalid_quantity' })
  expect((await updateItem(env.DB, f.item.id, f.owner, itemChanges({ quantity: 0 }, false))).quantity).toBe(0)
})

it('stores manual availability/note globally with 200-code-point validation and no loan state', async () => {
  const f = await fixture()
  await attachItem(env.DB, f.item.id, f.second.id, f.owner)
  await updateItem(env.DB, f.item.id, f.owner, itemChanges({ available: false, unavailable_note: '😀'.repeat(200) }, false))
  for (const cache of [f.first,f.second]) expect(await itemDetail(env.DB, f.item.id, f.admin, cache.id)).toMatchObject({ available: false, unavailable_note: '😀'.repeat(200) })
  expect(() => itemChanges({ unavailable_note: '😀'.repeat(201) }, false)).toThrow('invalid_unavailable_note')
  expect(() => itemChanges({ available: 0 }, false)).toThrow('invalid_available')
  await updateItem(env.DB, f.item.id, f.owner, itemChanges({ available: true, unavailable_note: null }, false))
  expect(await itemDetail(env.DB, f.item.id, f.owner)).toMatchObject({ available: true, unavailable_note: null })
  for (const caller of [f.admin,f.member]) await expect(updateItem(env.DB, f.item.id, caller, itemChanges({ available: false }, false),f.first.id)).rejects.toMatchObject({ status: 404 })
})

it('validates bounded text/quantity, trims nullable text and never interpolates SQL or accepts forged owners', async () => {
  for (const body of [{ title: '' }, { title: 'x'.repeat(121) }, { description: 'x'.repeat(2001) }, { quantity: -1 }, { quantity: '1' }, {}]) expect(() => itemChanges(body,false)).toThrow()
  expect(() => itemChanges({ owner_id: 'forged', title: 'Sugar' },true)).toThrow('not_found')
  const f = await fixture(), title = "Mixer'); DROP TABLE items; --"
  expect(await updateItem(env.DB,f.item.id,f.owner,itemChanges({ title, description: '  ' },false))).toMatchObject({ title, description: null })
  expect(await createItem(env.DB,f.owner,itemChanges({ title:'😀'.repeat(120),description:'😀'.repeat(2000),is_consumable:false },true))).toMatchObject({ title:'😀'.repeat(120) })
})

it('reopens current cache item screens and private library/attach APIs with cookies/CSRF/profile guards, not DO calls', async () => {
  const owner = await login(), stranger = await user()
  const info = await createCache(env.DB, owner.id, 'Tools', false), base = `/api/caches/${info.id}/items`
  expect((await worker.fetch(appRequest(base,{method:'POST',cookie:owner.cookie,body:{}}),env)).status).toBe(409)
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:owner.cookie,body:{display_name:'Owner'}}),env)
  const poisoned = { ...env, CACHES: { get: () => { throw new Error('No legacy DO access') } } } as unknown as Env
  for (const origin of [null,'null','https://foreign.test']) expect((await worker.fetch(appRequest(base,{method:'POST',cookie:owner.cookie,origin,body:{}}),poisoned)).status).toBe(403)
  const created = await worker.fetch(appRequest(base,{method:'POST',cookie:owner.cookie,body:{title:'Sugar',is_consumable:true,quantity:0}}),poisoned)
  expect(created.status).toBe(201)
  const item = await created.json() as {id:string}
  for (const path of [base,`${base}/${item.id}`,'/api/me/items',`/api/me/items/${item.id}`]) {
    const response = await worker.fetch(appRequest(path,{cookie:owner.cookie}),poisoned)
    expect(response.status).toBe(200)
    const payload = JSON.stringify(await response.json())
    for (const privateField of ['photo_path','operation_token','example.test']) expect(payload).not.toContain(privateField)
  }
  const other = await createCache(env.DB,owner.id,'Pantry',false)
  const attach = `/api/me/items/${item.id}/attachments/${other.id}`
  expect((await worker.fetch(appRequest(attach,{method:'PUT',cookie:owner.cookie,body:{}}),poisoned)).status).toBe(204)
  expect((await worker.fetch(appRequest(`/api/me/items/${item.id}`,{method:'PATCH',cookie:owner.cookie,body:{quantity:2}}),poisoned)).status).toBe(200)
  expect((await itemDetail(env.DB,item.id,owner.id,other.id)).quantity).toBe(2)
  await expect(itemDetail(env.DB,item.id,stranger,info.id)).rejects.toMatchObject({status:404})
  for (const path of [`${base}/${item.id}/requests`,'/api/requests']) expect((await worker.fetch(appRequest(path,{cookie:owner.cookie}),poisoned)).status).toBe(200)
  expect((await worker.fetch(appRequest(attach,{method:'DELETE',cookie:owner.cookie}),poisoned)).status).toBe(204)
  expect((await itemDetail(env.DB,item.id,owner.id)).id).toBe(item.id)
  expect((await worker.fetch(appRequest(`${base}/${item.id}`,{method:'DELETE',cookie:owner.cookie}),poisoned)).status).toBe(204)
  expect((await worker.fetch(appRequest(`/api/me/items/${item.id}`,{method:'DELETE',cookie:owner.cookie}),poisoned)).status).toBe(404)
})
