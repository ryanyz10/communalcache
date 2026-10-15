// UI-only browser proof: mock API, real built SPA. No provider or database calls.
// Public fixture code: 123456. Never run this server as the application.
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../web/dist/', import.meta.url))
const users = new Map()
const caches = new Map()
const items = new Map()
const photos = new Map()
const requests = new Map()
let vite
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  response.setHeader('Referrer-Policy', 'no-referrer')
  function json(value, status = 200) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(value))
  }
  if (path.startsWith('/api/')) {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const raw = Buffer.concat(chunks)
    let body = {}
    try { if (request.headers['content-type']?.startsWith('application/json')) body = JSON.parse(raw.toString() || '{}') }
    catch { json({error: 'invalid_json'}, 400); return }
    if (path === '/api/config') {
      const origin=`http://${request.headers.host}`
      json({app_base_url:origin,better_auth_url:origin,vapid_public_key:''})
      return
    }
    const sessionId = request.headers.cookie?.match(/(?:^|;\s*)ui_fixture=([^;]+)/)?.[1]
    let me = [...users.values()].find(user=>user.id===sessionId) ?? null
    const authenticated = !!me
    if (path === '/api/auth/email-otp/send-verification-otp') {
      json(body.email === 'failure@example.test' ? {error: 'email_unavailable'} : {success:true}, body.email === 'failure@example.test' ? 502 : 200)
      return
    }
    if (path === '/api/auth/sign-in/email-otp') {
      if (body.otp !== '123456') { json({code: 'INVALID_OTP'}, 400); return }
      me = users.get(body.email) ?? { id: randomUUID(), email: body.email, display_name: null }
      users.set(body.email,me)
      response.setHeader('Set-Cookie', `ui_fixture=${me.id}; HttpOnly; SameSite=Lax; Path=/`)
      json({user:me})
      return
    }
    if (path === '/api/auth/sign-out') {
      response.setHeader('Set-Cookie', 'ui_fixture=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/')
      json({success:true})
      return
    }
    if (path === '/api/me') {
      if (!authenticated || !me) { json({error: 'unauthorized'}, 401); return }
      if (request.method === 'PATCH') me.display_name = body.display_name.trim()
      json(me)
      return
    }
    if (path === '/api/requests') {
      if (!authenticated) { json({error:'unauthorized'},401); return }
      json({requests:[...requests.values()].filter(row=>row.owner_id===me.id || row.requester_id===me.id),unavailable_cache_ids:[],next_cursor:null})
      return
    }
    if (path === '/api/caches' || path.startsWith('/api/caches/')) {
      if (!authenticated || !me) { json({error:'unauthorized'},401); return }
      if (path === '/api/caches' && request.method === 'GET') {
        json([...caches.values()].map(cache=>({id:cache.id,name:cache.name})))
        return
      }
      if (path === '/api/caches' && request.method === 'POST') {
        if (!body.name?.trim() || [...body.name.trim()].length > 60) { json({error:'invalid_name'},400); return }
        const id=randomUUID()
        const cache={id,name:body.name.trim(),owner_id:me.id,requires_approval:!!body.requires_approval,invite_token:`${id}.${randomBytes(32).toString('base64url')}`}
        caches.set(id,cache)
        json(cache,201)
        return
      }
      if (path.endsWith('/join-requests') && request.method==='GET') { json([]); return }
      const decisionRoute=path.match(/^\/api\/caches\/([^/]+)\/requests\/([^/]+)\/(approve|reject)$/)
      if (decisionRoute) {
        const row=requests.get(decisionRoute[2])
        if (!row || row.cache_id!==decisionRoute[1] || row.owner_id!==me.id) { json({error:'not_found'},404); return }
        if (row.status!=='pending') { json({error:'request_not_pending'},409); return }
        if (decisionRoute[3]==='reject' && (!body.reason?.trim() || [...body.reason.trim()].length>500)) { json({error:'invalid_reason'},400); return }
        row.status=decisionRoute[3]==='approve'?'approved':'rejected'
        row.decision_reason=row.status==='rejected'?body.reason.trim():null
        row.decided_at=Date.now()
        if (row.status==='approved' && row.quantity!==null) items.get(row.item_id).quantity-=row.quantity
        json(row)
        return
      }
      const requestRoute=path.match(/^\/api\/caches\/([^/]+)\/items\/([^/]+)\/requests$/)
      if (requestRoute) {
        const item=items.get(requestRoute[2])
        if (!item || item.cache_id!==requestRoute[1]) { json({error:'not_found'},404); return }
        const queue=[...requests.values()].filter(row=>row.item_id===item.id)
        if (request.method==='GET') { json(queue.filter(row=>row.status==='pending' || row.owner_id===me.id || row.requester_id===me.id)); return }
        if (item.owner_id===me.id) { json({error:'not_found'},404); return }
        if (item.is_consumable && (!Number.isInteger(body.quantity) || body.quantity<1 || body.quantity>9999)) { json({error:'invalid_request_quantity'},400); return }
        const pending=queue.filter(row=>row.status==='pending').reduce((sum,row)=>sum+(row.quantity??0),0)
        if (item.is_consumable && body.quantity>item.quantity-pending) { json({error:'insufficient_stock'},409); return }
        const row={id:randomUUID(),cache_id:item.cache_id,cache_name:caches.get(item.cache_id).name,item_id:item.id,item_title:item.title,owner_id:item.owner_id,owner_name:item.owner_name,requester_id:me.id,requester_name:me.display_name,quantity:item.is_consumable?body.quantity:null,status:'pending',decision_reason:null,decided_at:null,created_at:Date.now()}
        requests.set(row.id,row)
        json(row,201)
        return
      }
      const photoRoute=path.match(/^\/api\/caches\/([^/]+)\/items\/([^/]+)\/photo$/)
      if (photoRoute) {
        const item=items.get(photoRoute[2])
        if (!item || item.cache_id!==photoRoute[1]) { json({error:'not_found'},404); return }
        if (request.method==='POST') {
          photos.set(item.id,{bytes:raw,type:request.headers['content-type']})
          item.photo_version=randomUUID()
          json(item)
          return
        }
        const photo=photos.get(item.id)
        if (!photo) { json({error:'not_found'},404); return }
        response.writeHead(200,{'Content-Type':photo.type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
        response.end(photo.bytes)
        return
      }
      const itemRoute=path.match(/^\/api\/caches\/([^/]+)\/items(?:\/([^/]+))?$/)
      if (itemRoute) {
        const cacheId=itemRoute[1], itemId=itemRoute[2]
        if (!caches.has(cacheId)) { json({error:'not_found'},404); return }
        if (!itemId && request.method === 'GET') { json([...items.values()].filter(item=>item.cache_id===cacheId)); return }
        if (!itemId && request.method === 'POST') {
          if (!body.title?.trim() || [...body.title.trim()].length>120) { json({error:'invalid_title'},400); return }
          if (body.is_consumable && (!Number.isInteger(body.quantity) || body.quantity<0 || body.quantity>9999)) { json({error:'invalid_quantity'},400); return }
          const item={id:randomUUID(),cache_id:cacheId,owner_id:me.id,owner_name:me.display_name,title:body.title.trim(),description:body.description??null,is_consumable:body.is_consumable,quantity:body.is_consumable?body.quantity:null,created_at:Date.now(),photo_version:null}
          items.set(item.id,item)
          json(item,201)
          return
        }
        const item=items.get(itemId)
        if (!item || item.cache_id!==cacheId) { json({error:'not_found'},404); return }
        if (request.method === 'PATCH') {
          if (!body.title?.trim() || [...body.title.trim()].length>120) { json({error:'invalid_title'},400); return }
          if (item.is_consumable && (!Number.isInteger(body.quantity) || body.quantity<0 || body.quantity>9999)) { json({error:'invalid_quantity'},400); return }
          const reserved=[...requests.values()].filter(row=>row.item_id===item.id && row.status==='pending').reduce((sum,row)=>sum+(row.quantity??0),0)
          if (item.is_consumable && body.quantity<reserved) { json({error:'quantity_reserved'},409); return }
          item.title=body.title.trim()
          item.description=body.description??null
          item.quantity=item.is_consumable?body.quantity:null
        }
        json(item)
        return
      }
      const match=path.match(/^\/api\/caches\/([^/]+)(\/invite\/rotate)?$/)
      const cache=match && caches.get(match[1])
      if (!cache) { json({error:'not_found'},404); return }
      if (match[2] && request.method === 'POST') cache.invite_token=`${cache.id}.${randomBytes(32).toString('base64url')}`
      if (request.method === 'PATCH') {
        if (body.name !== undefined) cache.name=body.name.trim()
        if (body.requires_approval !== undefined) cache.requires_approval=body.requires_approval
      }
      json({...cache,members:[{user_id:me.id,display_name:me.display_name}]})
      return
    }
    json({error:'not_found'},404)
    return
  }
  if (vite) { vite.middlewares(request,response,()=>{response.writeHead(404);response.end()}); return }
  try {
    const file = resolve(dist, '.' + path)
    if (file !== resolve(dist) && !file.startsWith(dist)) { response.writeHead(404); response.end(); return }
    const isAsset = path.startsWith('/assets/') || ['/favicon.svg','/sw.js','/manifest.webmanifest'].includes(path)
    const data = await readFile(isAsset ? file : resolve(dist, 'index.html'))
    const types = {'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.html':'text/html','.webmanifest':'application/manifest+json'}
    response.writeHead(200, { 'Content-Type': types[extname(isAsset ? file : 'index.html')] ?? 'application/octet-stream' })
    response.end(data)
  } catch { response.writeHead(404); response.end() }
})
if (process.env.UI_FIXTURE_DEV === '1') {
  const {createServer:createViteServer}=await import('../web/node_modules/vite/dist/node/index.js')
  vite=await createViteServer({root:fileURLToPath(new URL('../web/',import.meta.url)),configFile:fileURLToPath(new URL('../web/vite.config.ts',import.meta.url)),server:{middlewareMode:true,ws:{server}},appType:'spa'})
}
const port = Number(process.env.UI_FIXTURE_PORT ?? 4173)
server.listen(port, '127.0.0.1', () => console.log(`UI fixture ready at http://127.0.0.1:${port} (mock API, public code 123456)`))
