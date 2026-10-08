import { it, expect, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { runInDurableObject, runDurableObjectAlarm, abortAllDurableObjects, createScheduledController } from 'cloudflare:test'
import worker from '../src/index'
import { appRequest, login } from './helpers'
import { applyCacheIntent } from '../src/db'

async function seedUser(id: string, name = 'Neighbor') {
  await env.DB.prepare('INSERT INTO user(id, name, email, emailVerified, createdAt, updatedAt, display_name) VALUES (?, ?, ?, 1, ?, ?, ?)')
    .bind(id, '', `${id}@example.test`, new Date().toISOString(), new Date().toISOString(), name).run()
}
function cache(id = crypto.randomUUID()) { return { id, stub: env.CACHES.get(env.CACHES.idFromName(id)) } }
async function created() {
  const owner = crypto.randomUUID()
  await seedUser(owner, 'Owner')
  const { id, stub } = cache()
  const info = await stub.create(id, owner, 'Tools', false)
  return { id, stub, owner, info }
}
async function expectRpcFailure(call: PromiseLike<unknown>, message: string) {
  // Await native RPC thenables directly; Vitest .rejects causes spurious unhandled reports.
  let failure: unknown
  try { await call } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(Error)
  expect((failure as Error).message).toContain(message)
}
async function pending(stub: ReturnType<typeof cache>['stub']) {
  return runInDurableObject(stub, (_instance, state) => state.storage.sql.exec<{id:string;kind:string;payload:string}>('SELECT id, kind, payload FROM pending_sync ORDER BY sequence').toArray())
}

it('creates owner/config/intents atomically and reads immediately before discovery catches up', async () => {
  const { id, stub, owner, info } = await created()
  expect(info).toMatchObject({id, owner_id:owner, name:'Tools', requires_approval:false})
  const secret = info.invite_token.split('.')[1]
  expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(Uint8Array.from(atob(secret.replaceAll('-', '+').replaceAll('_', '/') + '='), c => c.charCodeAt(0))).toHaveLength(32)
  expect((await stub.detail(owner)).members).toEqual([{user_id:owner}])
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM caches').first('n')).toBe(0)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM my_caches').first('n')).toBe(0)
  expect((await pending(stub)).map(row => row.kind)).toEqual(['registry_upsert', 'discovery_upsert'])
  await stub.flushSync()
  expect(await env.DB.prepare('SELECT name FROM caches WHERE id = ?').bind(id).first('name')).toBe('Tools')
  expect(await env.DB.prepare('SELECT user_id FROM my_caches WHERE cache_id = ?').bind(id).first('user_id')).toBe(owner)
  expect(await pending(stub)).toHaveLength(0)
})

it('authorizes detail/settings/rotation in local SQL, not D1 discovery', async () => {
  const { id, stub, owner, info } = await created()
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec("INSERT INTO members VALUES ('member','member','active',1), ('pending','member','pending',1), ('removed','member','removed',1)")
  })
  const member = await stub.detail('member')
  expect(member.invite_token).toBe(info.invite_token)
  expect(member.members.map(row => row.user_id)).not.toContain('pending')
  expect(member.members.map(row => row.user_id)).not.toContain('removed')
  for (const user of ['outsider','pending','removed']) {
    await expectRpcFailure(stub.detail(user),'not_found')
    await expectRpcFailure(stub.update(user,{name:'Forged'}),'not_found')
    await expectRpcFailure(stub.rotateInvite(user),'not_found')
  }
  await expectRpcFailure(stub.update('member',{name:'Forged'}),'not_found')
  await expectRpcFailure(stub.rotateInvite('member'),'not_found')
  const changed = await stub.update(owner,{name:'Pantry',requires_approval:true})
  expect(changed).toMatchObject({name:'Pantry',requires_approval:true})
  const rotated = await stub.rotateInvite(owner)
  expect(rotated.invite_token).not.toBe(info.invite_token)
  expect((await stub.detail('member')).invite_token).toBe(rotated.invite_token)
  await expectRpcFailure(cache().stub.detail(owner),'not_found')
  expect((await stub.detail(owner)).id).toBe(id)
})

it('rolls back create and settings when intent insertion fails', async () => {
  const {id,stub} = cache()
  await runInDurableObject(stub, (_instance,state) => {
    state.storage.sql.exec("CREATE TRIGGER fail_discovery BEFORE INSERT ON pending_sync WHEN NEW.kind = 'discovery_upsert' BEGIN SELECT RAISE(ABORT, 'injected intent failure'); END")
  })
  await expectRpcFailure(stub.create(id,'owner','Tools',false),'injected intent failure')
  await runInDurableObject(stub, (_instance,state) => {
    expect(state.storage.sql.exec('SELECT 1 FROM cache_config').toArray()).toHaveLength(0)
    expect(state.storage.sql.exec('SELECT 1 FROM members').toArray()).toHaveLength(0)
    expect(state.storage.sql.exec('SELECT 1 FROM pending_sync').toArray()).toHaveLength(0)
    state.storage.sql.exec('DROP TRIGGER fail_discovery')
  })
  await stub.create(id,'owner','Tools',false)
  await runInDurableObject(stub, (_instance,state) => {
    state.storage.sql.exec("CREATE TRIGGER fail_registry BEFORE INSERT ON pending_sync WHEN NEW.kind = 'registry_upsert' BEGIN SELECT RAISE(ABORT, 'injected intent failure'); END")
  })
  await expectRpcFailure(stub.update('owner',{name:'Lost',requires_approval:true}),'injected intent failure')
  expect(await stub.detail('owner')).toMatchObject({name:'Tools',requires_approval:false})
  expect(await pending(stub)).toHaveLength(2)
})

it('keeps stable unique intent IDs and repairs the new-cache commit/alarm gap through an entry point', async () => {
  const { id, stub } = cache()
  const owner = crypto.randomUUID()
  await seedUser(owner)
  await runInDurableObject(stub, async (instance,state) => {
    const alarm = vi.spyOn(state.storage,'setAlarm').mockRejectedValue(new Error('injected scheduling crash'))
    const info = await instance.create(id,owner,'Tools',false)
    expect(info.id).toBe(id)
    alarm.mockRestore()
    expect(await state.storage.getAlarm()).toBeNull()
    expect(state.storage.sql.exec('SELECT 1 FROM pending_sync').toArray()).toHaveLength(2)
    expect(() => state.storage.sql.exec('INSERT INTO pending_sync(id,kind,payload,created_at) SELECT id,kind,payload,created_at FROM pending_sync LIMIT 1')).toThrow()
  })
  const intents = await pending(stub)
  expect(new Set(intents.map(row=>row.id)).size).toBe(2)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM caches').first('n')).toBe(0)
  // Registry Cron cannot discover this object until its first registry intent succeeds.
  await worker.scheduled(createScheduledController(), env)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM caches').first('n')).toBe(0)
  expect(await stub.detail(owner)).toMatchObject({id,name:'Tools'})
  expect(await runDurableObjectAlarm(stub)).toBe(true)
  expect(await pending(stub)).toHaveLength(0)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM my_caches').first('n')).toBe(1)
})

for (const boundary of ['registry_upsert','discovery_upsert']) {
  it(`replays a crash after ${boundary} D1 write but before local deletion without duplicates`, async () => {
    const {id,stub} = await created()
    const intents = await pending(stub)
    await runInDurableObject(stub, (_instance,state) => {
      state.storage.sql.exec(`CREATE TRIGGER fail_delete BEFORE DELETE ON pending_sync WHEN OLD.kind = '${boundary}' BEGIN SELECT RAISE(ABORT, 'injected delete crash'); END`)
    })
    await expectRpcFailure(stub.flushSync(),'injected delete crash')
    const remaining = await pending(stub)
    expect(remaining.map(row=>row.id)).toEqual(intents.filter(row=>boundary === 'registry_upsert' || row.kind === boundary).map(row=>row.id))
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM caches WHERE id = ?').bind(id).first('n')).toBe(1)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM my_caches WHERE cache_id = ?').bind(id).first('n')).toBe(boundary === 'registry_upsert' ? 0 : 1)
    await runInDurableObject(stub, (_instance,state) => {state.storage.sql.exec('DROP TRIGGER fail_delete')})
    await abortAllDurableObjects()
    // Forced teardown invalidates existing RPC channels; reacquire the same named object.
    const restarted = cache(id).stub
    await restarted.flushSync()
    await restarted.flushSync()
    expect(await pending(restarted)).toHaveLength(0)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM caches WHERE id = ?').bind(id).first('n')).toBe(1)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM my_caches WHERE cache_id = ?').bind(id).first('n')).toBe(1)
  })
}

it('serializes alarm and flush drains while newer settings intents arrive', async () => {
  const {id,stub,owner} = await created()
  await runInDurableObject(stub, async (instance,_state) => {
    const internals = instance as unknown as {drainWork:()=>Promise<void>}
    const original = internals.drainWork.bind(instance)
    let started!:()=>void
    let resume!:()=>void
    const began = new Promise<void>(resolve=>{started=resolve})
    const gate = new Promise<void>(resolve=>{resume=resolve})
    const drain = vi.spyOn(internals,'drainWork').mockImplementation(async()=>{started();await gate;await original()})
    const first = instance.flushSync()
    await began
    await instance.update(owner,{name:'Newest'})
    const second = instance.flushSync()
    const alarm = instance.alarm()
    resume()
    await Promise.all([first,second,alarm])
    expect(drain).toHaveBeenCalledTimes(1)
    drain.mockRestore()
  })
  expect(await env.DB.prepare('SELECT name FROM caches WHERE id = ?').bind(id).first('name')).toBe('Newest')
  expect(await pending(stub)).toHaveLength(0)
})

it('bounds each drain and leaves ordered work armed for subsequent alarms', async () => {
  const {id,stub,owner} = await created()
  for (let i=0;i<28;i++) await stub.update(owner,{name:`Name ${i}`})
  await stub.flushSync()
  expect(await pending(stub)).toHaveLength(5)
  expect(await env.DB.prepare('SELECT name FROM caches WHERE id = ?').bind(id).first('name')).toBe('Name 22')
  expect(await runDurableObjectAlarm(stub)).toBe(true)
  expect(await pending(stub)).toHaveLength(0)
  expect(await env.DB.prepare('SELECT name FROM caches WHERE id = ?').bind(id).first('name')).toBe('Name 27')
})

it('survives more than six sync failures and continues from alarms and registry Cron', async () => {
  const {id,stub,owner} = await created()
  await env.DB.exec("CREATE TRIGGER fail_registry BEFORE INSERT ON caches BEGIN SELECT RAISE(ABORT, 'injected D1 failure'); END")
  for (let attempt=0;attempt<8;attempt++) {
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await pending(stub)).toHaveLength(2)
    await runInDurableObject(stub,async(_instance,state)=>{expect(await state.storage.getAlarm()).not.toBeNull()})
  }
  await env.DB.exec('DROP TRIGGER fail_registry')
  expect(await runDurableObjectAlarm(stub)).toBe(true)
  await stub.update(owner,{name:'Recovered by Cron'})
  await runInDurableObject(stub,async(_instance,state)=>{await state.storage.deleteAlarm()})
  await worker.scheduled(createScheduledController(),env)
  expect(await pending(stub)).toHaveLength(0)
  expect(await env.DB.prepare('SELECT name FROM caches WHERE id = ?').bind(id).first('name')).toBe('Recovered by Cron')
})

it('advances a bounded registry cursor without giving stale discovery rows authority', async () => {
  const ids = Array.from({length:28},()=>crypto.randomUUID()).sort()
  await env.DB.batch(ids.map(id=>env.DB.prepare('INSERT INTO caches(id,name,created_at) VALUES (?, ?, 1)').bind(id,'Projection only')))
  await worker.scheduled(createScheduledController(),env)
  expect(await env.DB.prepare('SELECT cache_id FROM cache_sync_cursor').first('cache_id')).toBe(ids[24])
  await worker.scheduled(createScheduledController(),env)
  expect(await env.DB.prepare('SELECT cache_id FROM cache_sync_cursor').first('cache_id')).toBeNull()
  await expectRpcFailure(cache(ids[0]).stub.detail('outsider'),'not_found')
})

it('D1 effects are idempotent and do not create a reverse index ahead of registry', async () => {
  const owner=crypto.randomUUID(),id=crypto.randomUUID()
  await seedUser(owner)
  const discovery = JSON.stringify({cache_id:id,user_id:owner})
  await expect(applyCacheIntent(env.DB,'discovery_upsert',discovery)).rejects.toThrow()
  const registry = JSON.stringify({cache_id:id,name:'Tools',created_at:1})
  await applyCacheIntent(env.DB,'registry_upsert',registry)
  await applyCacheIntent(env.DB,'registry_upsert',registry)
  await applyCacheIntent(env.DB,'discovery_upsert',discovery)
  await applyCacheIntent(env.DB,'discovery_upsert',discovery)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM caches').first('n')).toBe(1)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM my_caches').first('n')).toBe(1)
})

it('Worker routes use live DO authority and enrich only public names', async () => {
  const caller=await login()
  const profile = appRequest('/api/me',{method:'PATCH',cookie:caller.cookie,body:{display_name:'Owner'}})
  expect((await worker.fetch(profile,env)).status).toBe(200)
  const response=await worker.fetch(appRequest('/api/caches',{method:'POST',cookie:caller.cookie,body:{name:'  Tools  ',owner_id:'forged',requires_approval:true}}),env)
  expect(response.status).toBe(201)
  const info=await response.json() as {id:string;owner_id:string;invite_token:string}
  expect(info.owner_id).toBe(caller.id)
  expect(await (await worker.fetch(appRequest('/api/caches',{cookie:caller.cookie}),env)).json()).toEqual([])
  const stub=cache(info.id).stub
  const detail=await worker.fetch(appRequest(`/api/caches/${info.id}`,{cookie:caller.cookie}),env)
  expect(await detail.json()).toMatchObject({id:info.id,members:[{user_id:caller.id,display_name:'Owner'}]})
  await stub.flushSync()
  const home=await (await worker.fetch(appRequest('/api/caches',{cookie:caller.cookie}),env)).json()
  expect(home).toEqual([{id:info.id,name:'Tools'}])
  expect(JSON.stringify(home)).not.toContain('example.test')
  // Deliberately drift the reverse index by making the formerly active owner a removed member.
  await runInDurableObject(stub,(_instance,state)=>{
    state.storage.sql.exec("UPDATE members SET role = 'member', status = 'removed' WHERE user_id = ?",caller.id)
    state.storage.sql.exec("INSERT INTO members VALUES ('replacement','owner','active',1)")
  })
  expect((await worker.fetch(appRequest(`/api/caches/${info.id}`,{cookie:caller.cookie}),env)).status).toBe(404)
  expect((await worker.fetch(appRequest(`/api/caches/${info.id}`,{method:'PATCH',cookie:caller.cookie,body:{name:'Forbidden'}}),env)).status).toBe(404)
})

it('validates cache names/approval fields, profile completion and disabled destructive paths', async () => {
  const caller=await login()
  expect((await worker.fetch(appRequest('/api/caches',{method:'POST',cookie:caller.cookie,body:{name:'Tools'}}),env)).status).toBe(409)
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:caller.cookie,body:{display_name:'Owner'}}),env)
  for(const body of [{name:''},{name:' '.repeat(3)},{name:'x'.repeat(61)},{name:3},{name:'Tools',requires_approval:'yes'},{}]) {
    expect((await worker.fetch(appRequest('/api/caches',{method:'POST',cookie:caller.cookie,body}),env)).status).toBe(400)
  }
  expect((await worker.fetch(appRequest('/api/caches',{method:'POST',cookie:caller.cookie,origin:null,body:{name:'Tools'}}),env)).status).toBe(403)
  const response=await worker.fetch(appRequest('/api/caches',{method:'POST',cookie:caller.cookie,body:{name:'😀'.repeat(60)}}),env)
  expect(response.status).toBe(201)
  const info=await response.json() as {id:string}
  expect((await worker.fetch(appRequest(`/api/caches/${info.id}`,{method:'DELETE',cookie:caller.cookie}),env)).status).toBe(405)
  expect((await worker.fetch(appRequest(`/api/caches/${info.id}`,{method:'PATCH',cookie:caller.cookie,body:{}}),env)).status).toBe(400)
  expect((await worker.fetch(appRequest(`/api/caches/${info.id}/invite/rotate`,{method:'POST',cookie:caller.cookie,body:{}}),env)).status).toBe(200)
})
