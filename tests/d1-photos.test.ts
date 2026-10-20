import { expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { createScheduledController } from 'cloudflare:test'
import worker from '../src/index'
import { attachItem, claimCleanup, createCache, createItem, finishCleanup, finishItemPhoto, joinCache } from '../src/db'
import { sweepPhotoCleanup } from '../src/cleanup'
import { itemChanges } from '../src/items'
import { appRequest, base, login } from './helpers'

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/f9sAAAAASUVORK5CYII='), char => char.charCodeAt(0))
const jpeg = new Uint8Array([255,216,255,224,0,2,255,217])
async function profile(email: string) {
  const caller = await login(email)
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:caller.cookie,body:{display_name:'Neighbor'}}),env)
  return caller
}
async function fixture() {
  const owner = await profile('owner@example.test'), member = await profile('member@example.test'), outsider = await profile('outsider@example.test')
  await env.DB.prepare("UPDATE user SET plan='plus' WHERE id=?").bind(member.id).run()
  const first = await createCache(env.DB,member.id,'Tools',false), second = await createCache(env.DB,member.id,'Pantry',false)
  for (const cache of [first,second]) await joinCache(env.DB,cache.id,owner.id,cache.invite_token.split('.')[1])
  const item = await createItem(env.DB,owner.id,itemChanges({title:'Mixer',is_consumable:false},true),first.id)
  await attachItem(env.DB,item.id,second.id,owner.id)
  return { owner,member,outsider,first,second,item,path:`/api/caches/${first.id}/items/${item.id}/photo`,ownPath:`/api/me/items/${item.id}/photo` }
}
function upload(path: string, cookie: string, bytes: BodyInit = png, type = 'image/png', origin: string | null = base) {
  return new Request(base+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':type,...(origin===null?{}:{Origin:origin})},body:bytes})
}
function pointer(id: string) { return env.DB.prepare('SELECT photo_path FROM items WHERE id=?').bind(id).first<string>('photo_path') }
function intents() { return env.DB.prepare('SELECT id,owner_id,item_id,kind,target,claim_token,claim_until FROM r2_cleanup ORDER BY id').all<{id:string;owner_id:string;item_id:string;kind:'exact'|'prefix';target:string;claim_token:string|null;claim_until:number|null}>() }
async function cleanupIntent(owner: string, item: string, target: string, kind: 'exact'|'prefix' = 'exact', id = crypto.randomUUID()) {
  await env.DB.prepare('INSERT INTO r2_cleanup(id,owner_id,item_id,kind,target,created_at) VALUES (?,?,?,?,?,?)').bind(id,owner,item,kind,target,Date.now()).run()
  return id
}

it('uploads owner-scoped immutable photos and streams the same private image through every authorized attachment', async () => {
  const f = await fixture()
  expect((await worker.fetch(appRequest(f.path),env)).status).toBe(404)
  expect((await worker.fetch(upload(f.path,f.member.cookie),env)).status).toBe(404)
  expect((await worker.fetch(appRequest(f.path,{cookie:f.outsider.cookie}),env)).status).toBe(404)
  const response = await worker.fetch(upload(f.path,f.owner.cookie),env)
  expect(response.status).toBe(200)
  const item = await response.json() as {photo_version:string}
  const key = await pointer(f.item.id)
  expect(key).toBe(`${f.owner.id}/${f.item.id}/${item.photo_version}`)
  for (const hidden of ['photo_path','operation_token','example.test']) expect(JSON.stringify(item)).not.toContain(hidden)
  for (const path of [f.path,`/api/caches/${f.second.id}/items/${f.item.id}/photo`,f.ownPath]) {
    const read = await worker.fetch(new Request(base+path+'?v=untrusted',{headers:{Cookie:path===f.ownPath?f.owner.cookie:f.member.cookie,'If-None-Match':'*'}}),env)
    expect(read.status).toBe(200)
    expect(read.headers.get('Cache-Control')).toBe('private, no-store')
    expect(read.headers.get('Content-Type')).toBe('image/png')
    expect(read.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(png)
  }
  expect((await worker.fetch(appRequest(f.ownPath,{cookie:f.member.cookie}),env)).status).toBe(404)
})

it('refuses cache photo reads after caller or owner membership loss, retaining library/photo/other-cache access', async () => {
  const f = await fixture()
  await worker.fetch(upload(f.ownPath,f.owner.cookie),env)
  const key = await pointer(f.item.id)
  await env.DB.prepare("UPDATE memberships SET status='pending' WHERE cache_id=? AND user_id=?").bind(f.first.id,f.owner.id).run()
  expect((await worker.fetch(appRequest(f.path,{cookie:f.member.cookie}),env)).status).toBe(404)
  await env.DB.prepare("UPDATE memberships SET status='removed' WHERE cache_id=? AND user_id=?").bind(f.first.id,f.owner.id).run()
  expect((await worker.fetch(appRequest(f.path,{cookie:f.owner.cookie}),env)).status).toBe(404)
  expect((await worker.fetch(upload(f.path,f.owner.cookie),env)).status).toBe(404)
  expect((await worker.fetch(appRequest(f.ownPath,{cookie:f.owner.cookie}),env)).status).toBe(200)
  expect((await worker.fetch(appRequest(`/api/caches/${f.second.id}/items/${f.item.id}/photo`,{cookie:f.member.cookie}),env)).status).toBe(200)
  await worker.fetch(upload(f.ownPath,f.owner.cookie,jpeg,'image/jpeg'),env)
  expect(await pointer(f.item.id)).not.toBe(key)
  expect((await intents()).results.map(row=>row.target)).toEqual([key])
})

it('commits replacement cleanup with the photo pointer and preserves current keys after uncertain finalization', async () => {
  const f = await fixture()
  await worker.fetch(upload(f.path,f.owner.cookie),env)
  const first = (await pointer(f.item.id))!
  await worker.fetch(upload(f.path,f.owner.cookie,jpeg,'image/jpeg'),env)
  const second = (await pointer(f.item.id))!
  expect((await intents()).results.map(row=>row.target)).toEqual([first])
  expect(await finishItemPhoto(env.DB,f.item.id,f.owner.id,second,false,f.first.id)).toBe(false)
  expect((await intents()).results.map(row=>row.target)).toEqual([first])
  expect(await finishItemPhoto(env.DB,f.item.id,f.owner.id,first,true,f.first.id)).toBe(false)
  expect(await pointer(f.item.id)).toBe(second)
  await worker.scheduled(createScheduledController(),env)
  expect(await env.BUCKET.head(first)).toBeNull()
  expect(await env.BUCKET.head(second)).not.toBeNull()
  expect((await intents()).results).toEqual([])
})

for (const race of ['removed','ownership_lost','item_deleted','inactive']) {
  it(`rechecks guarded D1 authority after R2 put and retains rejected-key cleanup when ${race}`, async () => {
    const f = await fixture(), put = env.BUCKET.put.bind(env.BUCKET)
    vi.spyOn(env.BUCKET,'put').mockImplementation(async (key,body,options)=>{
      const result = await put(key,body,options)
      if (race==='removed') await env.DB.prepare("UPDATE memberships SET status='removed' WHERE cache_id=? AND user_id=?").bind(f.first.id,f.owner.id).run()
      if (race==='ownership_lost') await env.DB.prepare('UPDATE items SET owner_id=? WHERE id=?').bind(f.member.id,f.item.id).run()
      if (race==='item_deleted') await env.DB.prepare('DELETE FROM items WHERE id=?').bind(f.item.id).run()
      if (race==='inactive') await env.DB.prepare('UPDATE items SET active=0 WHERE id=?').bind(f.item.id).run()
      return result
    })
    expect((await worker.fetch(upload(f.path,f.owner.cookie),env)).status).toBe(404)
    const rows = (await intents()).results
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({owner_id:f.owner.id,item_id:f.item.id,kind:'exact'})
    expect(await env.BUCKET.head(rows[0].target)).not.toBeNull()
    await sweepPhotoCleanup(env)
    expect(await env.BUCKET.head(rows[0].target)).toBeNull()
    expect((await intents()).results).toEqual([])
  })
}

it('records cleanup after an uncertain R2 put failure without replacing the current photo', async () => {
  const f = await fixture()
  await worker.fetch(upload(f.path,f.owner.cookie),env)
  const current = await pointer(f.item.id), put = env.BUCKET.put.bind(env.BUCKET)
  vi.spyOn(env.BUCKET,'put').mockImplementation(async (key,body,options)=>{await put(key,body,options);throw new Error('injected R2 response failure')})
  expect((await worker.fetch(upload(f.path,f.owner.cookie),env)).status).toBe(500)
  expect(await pointer(f.item.id)).toBe(current)
  const rows = (await intents()).results
  expect(rows).toHaveLength(1)
  await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(rows[0].target)).toBeNull()
  expect(await env.BUCKET.head(current!)).not.toBeNull()
})

it('rolls the pointer and replacement intent back if SQL cleanup insertion fails, then records rejected upload cleanup', async () => {
  const f = await fixture()
  await worker.fetch(upload(f.path,f.owner.cookie),env)
  const current = await pointer(f.item.id)
  await env.DB.exec("CREATE TRIGGER fail_old_cleanup BEFORE INSERT ON r2_cleanup WHEN NEW.target=(SELECT photo_path FROM items LIMIT 1) BEGIN SELECT RAISE(ABORT,'injected cleanup failure'); END")
  expect((await worker.fetch(upload(f.path,f.owner.cookie,jpeg,'image/jpeg'),env)).status).toBe(500)
  expect(await pointer(f.item.id)).toBe(current)
  const rows = (await intents()).results
  expect(rows).toHaveLength(1)
  expect(rows[0].target).not.toBe(current)
  await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(rows[0].target)).toBeNull()
  expect(await env.BUCKET.head(current!)).not.toBeNull()
})

it('keeps concurrent immutable replacements isolated and never cleans the final current version', async () => {
  const f = await fixture()
  const results = await Promise.all([worker.fetch(upload(f.path,f.owner.cookie),env),worker.fetch(upload(f.ownPath,f.owner.cookie,jpeg,'image/jpeg'),env)])
  expect(results.every(row=>row.status===200)).toBe(true)
  const current = await pointer(f.item.id), rows = (await intents()).results
  expect(rows).toHaveLength(1)
  expect(rows[0].target).not.toBe(current)
  await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(current!)).not.toBeNull()
  expect(await env.BUCKET.head(rows[0].target)).toBeNull()
})

it('does not claim current exact/prefix photos or delete outside a validated owner/item scope', async () => {
  const f = await fixture()
  await worker.fetch(upload(f.path,f.owner.cookie),env)
  const current = (await pointer(f.item.id))!, prefix = `${f.owner.id}/${f.item.id}/`
  const exact = await cleanupIntent(f.owner.id,f.item.id,current), scoped = await cleanupIntent(f.owner.id,f.item.id,prefix,'prefix')
  expect(await claimCleanup(env.DB,exact,crypto.randomUUID(),Date.now())).toBeNull()
  expect(await claimCleanup(env.DB,scoped,crypto.randomUUID(),Date.now())).toBeNull()
  const foreign = `${f.member.id}/${f.item.id}/${crypto.randomUUID()}`
  await env.BUCKET.put(foreign,'keep')
  await cleanupIntent(f.owner.id,f.item.id,foreign)
  for (let count=0;count<3;count++) await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(current)).not.toBeNull()
  expect(await env.BUCKET.head(foreign)).not.toBeNull()
  expect((await intents()).results).toHaveLength(3)
})

it('guards cleanup claim competition and stale completion, retrying expired leases indefinitely', async () => {
  const f = await fixture(), target = `${f.owner.id}/${f.item.id}/${crypto.randomUUID()}`
  await env.BUCKET.put(target,'orphan')
  const id = await cleanupIntent(f.owner.id,f.item.id,target)
  const claims = await Promise.all([claimCleanup(env.DB,id,'first',Date.now()),claimCleanup(env.DB,id,'second',Date.now())])
  expect(claims.filter(Boolean)).toHaveLength(1)
  await env.DB.prepare('UPDATE r2_cleanup SET claim_until=? WHERE id=?').bind(Date.now()-1,id).run()
  expect(await claimCleanup(env.DB,id,'new',Date.now())).not.toBeNull()
  expect((await finishCleanup(env.DB,id,'first',true)).meta.changes).toBe(0)
  expect((await finishCleanup(env.DB,id,'second',true)).meta.changes).toBe(0)
  await env.DB.prepare('UPDATE r2_cleanup SET claim_until=? WHERE id=?').bind(Date.now()-1,id).run()
  const remove = vi.spyOn(env.BUCKET,'delete')
  await Promise.all([sweepPhotoCleanup(env),sweepPhotoCleanup(env)])
  expect(remove).toHaveBeenCalledTimes(1)
  expect((await intents()).results).toEqual([])
})

it('bounds prefix work to one 100-key page, retaining durable work until a later empty-page confirmation', async () => {
  const f = await fixture(), orphanItem = crypto.randomUUID(), prefix = `${f.owner.id}/${orphanItem}/`
  await cleanupIntent(f.owner.id,orphanItem,prefix,'prefix')
  await Promise.all(Array.from({length:105},()=>env.BUCKET.put(prefix+crypto.randomUUID(),'orphan')))
  const list = vi.spyOn(env.BUCKET,'list')
  await sweepPhotoCleanup(env)
  expect((await env.BUCKET.list({prefix})).objects).toHaveLength(5)
  expect((await intents()).results).toHaveLength(1)
  await sweepPhotoCleanup(env)
  expect((await intents()).results).toHaveLength(1)
  await sweepPhotoCleanup(env)
  expect((await intents()).results).toEqual([])
  expect(list.mock.calls.filter(call=>call[0]?.limit===100)).toHaveLength(3)
})

it('advances a ten-row cursor past repeatedly failing cleanup so later rows are not starved', async () => {
  const f = await fixture(), ids = Array.from({length:12},()=>crypto.randomUUID()).sort(), targets: string[] = []
  for (const id of ids) {
    const key = `${f.owner.id}/${f.item.id}/${crypto.randomUUID()}`
    targets.push(key);await env.BUCKET.put(key,'orphan');await cleanupIntent(f.owner.id,f.item.id,key,'exact',id)
  }
  const remove = env.BUCKET.delete.bind(env.BUCKET)
  const failure = vi.spyOn(env.BUCKET,'delete').mockImplementation(async key=>{if(key===targets[0])throw new Error('injected cleanup failure');await remove(key)})
  await sweepPhotoCleanup(env)
  expect(await env.DB.prepare('SELECT cleanup_id FROM r2_cleanup_cursor').first('cleanup_id')).toBe(ids[9])
  expect((await intents()).results.map(row=>row.id)).toEqual([ids[0],ids[10],ids[11]])
  await sweepPhotoCleanup(env)
  expect(await env.DB.prepare('SELECT cleanup_id FROM r2_cleanup_cursor').first('cleanup_id')).toBeNull()
  expect((await intents()).results.map(row=>row.id)).toEqual([ids[0]])
  failure.mockRestore()
  await sweepPhotoCleanup(env)
  expect((await intents()).results).toEqual([])
})

it('retains cleanup after external deletion succeeds but its D1 completion fails, then replays idempotently', async () => {
  const f = await fixture(), key = `${f.owner.id}/${f.item.id}/${crypto.randomUUID()}`
  await env.BUCKET.put(key,'orphan')
  await cleanupIntent(f.owner.id,f.item.id,key)
  await env.DB.exec("CREATE TRIGGER fail_cleanup_completion BEFORE DELETE ON r2_cleanup BEGIN SELECT RAISE(ABORT,'injected completion failure'); END")
  await sweepPhotoCleanup(env)
  expect(await env.BUCKET.head(key)).toBeNull()
  expect((await intents()).results).toHaveLength(1)
  await env.DB.exec('DROP TRIGGER fail_cleanup_completion')
  expect((await intents()).results[0].claim_until).not.toBeNull()
  await env.DB.prepare('UPDATE r2_cleanup SET claim_until=?').bind(Date.now()-1).run()
  await sweepPhotoCleanup(env)
  expect((await intents()).results).toEqual([])
})

it('bounds ten nonempty prefix intents to 23 D1 queries and 20 R2 calls', async () => {
  const f = await fixture()
  for(let index=0;index<10;index++) {
    const item = crypto.randomUUID(), prefix = `${f.owner.id}/${item}/`
    await env.BUCKET.put(prefix+crypto.randomUUID(),'orphan')
    await cleanupIntent(f.owner.id,item,prefix,'prefix')
  }
  const queries = vi.spyOn(env.DB,'prepare'), list = vi.spyOn(env.BUCKET,'list'), remove = vi.spyOn(env.BUCKET,'delete')
  await sweepPhotoCleanup(env)
  expect(queries).toHaveBeenCalledTimes(23)
  expect(list).toHaveBeenCalledTimes(10)
  expect(remove).toHaveBeenCalledTimes(10)
  await env.DB.exec("CREATE TRIGGER fail_page_completion BEFORE DELETE ON r2_cleanup BEGIN SELECT RAISE(ABORT,'injected completion failure'); END")
  await env.DB.prepare('UPDATE r2_cleanup_cursor SET cleanup_id=NULL').run()
  queries.mockClear(); list.mockClear(); remove.mockClear()
  await sweepPhotoCleanup(env)
  expect(queries).toHaveBeenCalledTimes(23)
  expect(list).toHaveBeenCalledTimes(10)
  expect(remove).not.toHaveBeenCalled()
  expect((await intents()).results.every(row=>row.claim_token!==null)).toBe(true)
})

it('protects photo mutations with Origin/profile guards and validates uploads before R2 writes', async () => {
  const f = await fixture(), put = vi.spyOn(env.BUCKET,'put')
  for(const origin of [null,'null','https://foreign.test'])expect((await worker.fetch(upload(f.path,f.owner.cookie,png,'image/png',origin),env)).status).toBe(403)
  expect((await worker.fetch(upload(f.path,f.owner.cookie,'<svg/>','image/jpeg'),env)).status).toBe(415)
  await env.DB.prepare('UPDATE user SET display_name=NULL WHERE id=?').bind(f.owner.id).run()
  expect((await worker.fetch(upload(f.path,f.owner.cookie),env)).status).toBe(409)
  expect(put).not.toHaveBeenCalled()
})
