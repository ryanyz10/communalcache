import { afterEach,expect,it,vi } from 'vitest'
import { persistItem,type Item,type ItemSaveProgress } from './items'
const item:Item={id:'one-canonical-id',cache_id:null,owner_id:'owner',owner_name:'Ryan',title:'Jars',description:null,is_consumable:true,quantity:8,created_at:1,photo_version:null}
const input={cacheId:null,itemId:undefined,cacheIds:['a','b','c'],photo:null,body:{title:'Jars',is_consumable:true,quantity:8,description:null}}
function progress():ItemSaveProgress{return {item:null,remainingCacheIds:[],remainingDetachIds:[],failedCacheId:null,photoPending:false,stage:'saving'}}
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
it('edits fields then photo then cache diff, preserving successes and retrying only remaining removals',async()=>{
  let fail=true
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(path,init)=>{
    if(init?.method==='PATCH')return Response.json(item)
    if(String(path).endsWith('/photo'))return Response.json({...item,photo_version:'uploaded'})
    if(String(path).endsWith('/b') && fail)return Response.json({error:'not_found'},{status:404})
    return new Response(null,{status:204})
  })
  const state=progress(),applied=vi.fn(),photo=new Blob(['jpeg'],{type:'image/jpeg'})
  const edit={...input,itemId:item.id,cacheId:'a',cacheIds:['c'],initialCacheIds:['a','b'],photo}
  await expect(persistItem(state,edit,()=>{},applied)).rejects.toMatchObject({status:404})
  expect(state).toMatchObject({photoPending:false,remainingCacheIds:[],remainingDetachIds:['b','a'],failedCacheId:'b'})
  expect(applied.mock.calls).toEqual([['c',true]])
  fail=false
  expect((await persistItem(state,edit,()=>{},applied)).photo_version).toBe('uploaded')
  expect(fetch.mock.calls.map(call=>[call[0],call[1]?.method])).toEqual([
    [`/api/caches/a/items/${item.id}`,'PATCH'],[`/api/me/items/${item.id}/photo`,'POST'],
    [`/api/me/items/${item.id}/attachments/c`,'PUT'],[`/api/me/items/${item.id}/attachments/b`,'DELETE'],
    [`/api/me/items/${item.id}/attachments/b`,'DELETE'],[`/api/me/items/${item.id}/attachments/a`,'DELETE'],
  ])
  expect(state.remainingDetachIds).toEqual([])
  expect(state.failedCacheId).toBeNull()
})
it('does not reattach unchanged edit caches or remove anything after an addition fails',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(_path,init)=>init?.method==='PATCH'?Response.json(item):Response.json({error:'not_found'},{status:404}))
  await persistItem(progress(),{...input,itemId:item.id,cacheIds:['a','b'],initialCacheIds:['a','b']},()=>{})
  expect(fetch).toHaveBeenCalledOnce()
  fetch.mockClear()
  const state=progress()
  await expect(persistItem(state,{...input,itemId:item.id,cacheIds:['c'],initialCacheIds:['a','b']},()=>{})).rejects.toMatchObject({status:404})
  expect(fetch.mock.calls.map(call=>call[1]?.method)).toEqual(['PATCH','PUT'])
  expect(state.remainingDetachIds).toEqual(['a','b'])
})
it('retains an exact removal intent on failure, retries DELETE without PATCH and never repeats it after later sharing failure',async()=>{
  let deleteAttempts=0,shareAttempts=0
  const saved={...item,photo_version:'saved-version'}
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async (_path,init)=>{
    if(init?.method==='PATCH')return Response.json(saved)
    if(init?.method==='DELETE')return ++deleteAttempts===1?Response.json({error:'photo_changed'},{status:409}):new Response(null,{status:204})
    return ++shareAttempts===1?Response.json({error:'not_found'},{status:404}):new Response(null,{status:204})
  })
  const state=progress(),edit={...input,itemId:item.id,removePhotoVersion:'saved-version',cacheIds:['a'],initialCacheIds:[]}
  await expect(persistItem(state,edit,()=>{})).rejects.toMatchObject({status:409})
  expect(state).toMatchObject({photoPending:true,removePhotoVersion:'saved-version',stage:'photo'})
  await expect(persistItem(state,edit,()=>{})).rejects.toMatchObject({status:404})
  expect(state.item?.photo_version).toBeNull()
  await persistItem(state,edit,()=>{})
  expect(fetch.mock.calls.map(call=>call[1]?.method)).toEqual(['PATCH','DELETE','DELETE','PUT','PUT'])
  expect(fetch.mock.calls[1][1]?.body).toBe('{"photo_version":"saved-version"}')
  expect(fetch.mock.calls[2][1]?.body).toBe(fetch.mock.calls[1][1]?.body)
})

it('a replacement selection supersedes a staged removal and keeps existing replacement cleanup semantics',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async (_path,init)=>Response.json({...item,photo_version:init?.method==='POST'?'new-version':'old-version'}))
  const state=progress()
  await persistItem(state,{...input,itemId:item.id,cacheIds:[],photo:new Blob(['jpeg'],{type:'image/jpeg'}),removePhotoVersion:'old-version'},()=>{})
  expect(fetch.mock.calls.map(call=>call[1]?.method)).toEqual(['PATCH','POST'])
  expect(state.item?.photo_version).toBe('new-version')
})

it('can explicitly keep the current photo after failed removal and continue sharing without another photo call',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async (_path,init)=>init?.method==='PATCH'?Response.json({...item,photo_version:'saved-version'}):init?.method==='DELETE'?Response.json({error:'photo_changed'},{status:409}):new Response(null,{status:204}))
  const state=progress(),edit={...input,itemId:item.id,removePhotoVersion:'saved-version',cacheIds:['a'],initialCacheIds:[]}
  await expect(persistItem(state,edit,()=>{})).rejects.toMatchObject({status:409})
  state.photoPending=false;state.removePhotoVersion=null
  await persistItem(state,edit,()=>{})
  expect(fetch.mock.calls.map(call=>call[1]?.method)).toEqual(['PATCH','DELETE','PUT'])
  expect(state.item?.photo_version).toBe('saved-version')
})

it('edits by PATCH, never creates a second item and keeps the item type out of edit input',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json(item)),state=progress()
  await persistItem(state,{...input,itemId:item.id,cacheIds:[],body:{title:'Updated',description:null,quantity:8}},()=>{})
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch).toHaveBeenCalledWith(`/api/me/items/${item.id}`,expect.objectContaining({method:'PATCH',body:JSON.stringify({title:'Updated',description:null,quantity:8})}))
})
