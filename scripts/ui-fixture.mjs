// UI-only browser proof: mock API, real built SPA. No provider or database calls.
// Public fixture code: 123456. Never run this server as the application.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../web/dist/', import.meta.url))
let me = null
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
    json({error:'not_found'},404)
    return
  }
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
const port = Number(process.env.UI_FIXTURE_PORT ?? 4173)
server.listen(port, '127.0.0.1', () => console.log(`UI fixture ready at http://127.0.0.1:${port} (mock API, public code 123456)`))
