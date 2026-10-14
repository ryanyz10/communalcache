// UI-only browser proof: mock API, real built SPA. No provider or database calls.
// Public fixture code: 123456. Never run this server as the application.
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../web/dist/', import.meta.url))
let me = null
const caches = new Map()
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
    let body = {}
    try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}') }
    catch { json({error: 'invalid_json'}, 400); return }
    const authenticated = request.headers.cookie?.includes('ui_fixture=active')
    if (path === '/api/auth/email-otp/send-verification-otp') {
      json(body.email === 'failure@example.test' ? {error: 'email_unavailable'} : {success:true}, body.email === 'failure@example.test' ? 502 : 200)
      return
    }
    if (path === '/api/auth/sign-in/email-otp') {
      if (body.otp !== '123456') { json({code: 'INVALID_OTP'}, 400); return }
      me = { id: 'fixture-user', email: body.email, display_name: null }
      response.setHeader('Set-Cookie', 'ui_fixture=active; HttpOnly; SameSite=Lax; Path=/')
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
    const isAsset = path.startsWith('/assets/') || path === '/favicon.svg'
    const data = await readFile(isAsset ? file : resolve(dist, 'index.html'))
    const types = {'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.html':'text/html'}
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
