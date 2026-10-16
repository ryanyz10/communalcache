import { afterEach,expect,it,vi } from 'vitest'
import { persistItem,type Item,type ItemSaveProgress } from './items'
const item:Item={id:'one-canonical-id',cache_id:null,owner_id:'owner',owner_name:'Ryan',title:'Jars',description:null,is_consumable:true,quantity:8,created_at:1,photo_version:null}
const input={cacheId:null,itemId:undefined,cacheIds:['a','b','c'],photo:null,body:{title:'Jars',is_consumable:true,quantity:8,description:null}}
function progress():ItemSaveProgress{return {item:null,remainingCacheIds:[],photoPending:false,stage:'saving'}}
afterEach(()=>{vi.restoreAllMocks()})
it('creates once, retains earlier attachment successes and retries only the remaining cache IDs',async()=>{
  let fail=true
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async path=>{
    if(path==='/api/me/items')return Response.json(item)
    if(String(path).endsWith('/b') && fail)return Response.json({error:'not_found'},{status:404})
    return new Response(null,{status:204})
  })
  const state=progress(),changed=vi.fn()
  await expect(persistItem(state,input,changed)).rejects.toMatchObject({status:404})
  expect(state).toMatchObject({item,remainingCacheIds:['b','c'],stage:'sharing',photoPending:false})
  fail=false
  expect(await persistItem(state,input,changed)).toEqual(item)
  expect(fetch.mock.calls.map(call=>call[0])).toEqual(['/api/me/items',...['a','b','b','c'].map(id=>`/api/me/items/${item.id}/attachments/${id}`)])
  expect(fetch.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(1)
  expect(state.remainingCacheIds).toEqual([])
})
it('uses atomic cache create+first attachment and never separately repeats that target',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async path=>String(path)==='/api/caches/a/items'?Response.json({...item,cache_id:'a'}):new Response(null,{status:204}))
  await persistItem(progress(),{...input,cacheId:'a'},()=>{})
  expect(fetch.mock.calls.map(call=>call[0])).toEqual(['/api/caches/a/items',`/api/me/items/${item.id}/attachments/b`,`/api/me/items/${item.id}/attachments/c`])
  expect(JSON.stringify(fetch.mock.calls)).not.toMatch(/owner_id|requester_id/)
})
it('retains the item after failed photo upload and can explicitly continue without photo before sharing',async()=>{
  const photo=new Blob(['jpeg'],{type:'image/jpeg'})
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async path=>{
    if(path==='/api/me/items')return Response.json(item)
    if(String(path).endsWith('/photo'))return Response.json({error:'invalid_photo'},{status:400})
    return new Response(null,{status:204})
  })
  const state=progress()
  await expect(persistItem(state,{...input,photo},()=>{})).rejects.toMatchObject({status:400})
  expect(state).toMatchObject({item,photoPending:true,stage:'photo',remainingCacheIds:['a','b','c']})
  state.photoPending=false
  await persistItem(state,{...input,photo},()=>{})
  expect(fetch.mock.calls.filter(call=>String(call[0]).endsWith('/photo'))).toHaveLength(1)
  expect(fetch.mock.calls.filter(call=>call[0]==='/api/me/items')).toHaveLength(1)
  expect(state.stage).toBe('done')
})
it('does not upload again when a later sharing failure is retried, and preserves the uploaded version',async()=>{
  let fail=true
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async path=>{
    if(path==='/api/me/items')return Response.json(item)
    if(String(path).endsWith('/photo'))return Response.json({...item,photo_version:'uploaded'})
    if(fail)return Response.json({error:'not_found'},{status:404})
    return new Response(null,{status:204})
  })
  const state=progress(),photo=new Blob(['jpeg'],{type:'image/jpeg'})
  await expect(persistItem(state,{...input,photo},()=>{})).rejects.toMatchObject({status:404})
  expect(state.item?.photo_version).toBe('uploaded')
  fail=false
  expect((await persistItem(state,{...input,photo},()=>{})).photo_version).toBe('uploaded')
  expect(fetch.mock.calls.filter(call=>String(call[0]).endsWith('/photo'))).toHaveLength(1)
})
it('edits by PATCH, never creates a second item and keeps the item type out of edit input',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json(item)),state=progress()
  await persistItem(state,{...input,itemId:item.id,cacheIds:[],body:{title:'Updated',description:null,quantity:8}},()=>{})
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch).toHaveBeenCalledWith(`/api/me/items/${item.id}`,expect.objectContaining({method:'PATCH',body:JSON.stringify({title:'Updated',description:null,quantity:8})}))
})
