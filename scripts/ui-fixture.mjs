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
const profilePhotos = new Map()
const contacts = new Map()
const requests = new Map()
const magicLinks = new Map()
let lastMagicLink = ''
let vite
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost'), path = url.pathname
  if (path === '/__fixture/compare') {
    const requested=url.searchParams.get('screen'), screen=['home','cache','item','requests','account','signin','landing'].includes(requested)?requested:'home', wide=url.searchParams.get('layout')==='wide'
    // Iframes have real independent viewport widths, including the desktop breakpoint.
    const width=wide?1280:390, height=screen==='landing'?(wide?1050:1500):(wide?800:780), scale=wide?0.75:0.77
    const frames=(wide?[url.searchParams.get('theme')==='evening'?'evening':'sunny']:['sunny','evening']).map(theme=>`<section style="width:${width*scale}px;height:${height*scale+24}px"><b>${wide?'Wide':'Phone'} · ${theme} · ${screen}</b><iframe title="${theme} ${screen}" style="display:block;border:0;transform-origin:top left;transform:scale(${scale});width:${width}px;height:${height}px" src="/__fixture/cozy?screen=${screen}&theme=${theme}"></iframe></section>`).join('')
    response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'})
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cozy comparison fixture</title><body style="margin:8px;background:#ddd;font:14px system-ui;display:flex;justify-content:center;gap:16px">${frames}</body></html>`);return
  }
  if (path === '/__fixture/cozy') {
    // Stable presentation samples only. This server is never the application.
    const owner='11111111-1111-4111-8111-111111111111', member='22222222-2222-4222-8222-222222222222', sam='99999999-9999-4999-8999-999999999999'
    const cacheId='33333333-3333-4333-8333-333333333333', itemId='44444444-4444-4444-8444-444444444444'
    const members=['Ryan','Priya','Sam','Lee','Kai','Ana'].map((display_name,index)=>({user_id:index===0?owner:index===1?member:index===2?sam:`fixture-member-${index}`,display_name}))
    users.set('ryan@fixture.test',{id:owner,email:'ryan@fixture.test',display_name:'Ryan'})
    users.set('priya@fixture.test',{id:member,email:'priya@fixture.test',display_name:'Priya'})
    users.set('sam@fixture.test',{id:sam,email:'sam@fixture.test',display_name:'Sam'})
    for (const [id,name,cacheOwner] of [[cacheId,'Maple St',owner],['55555555-5555-4555-8555-555555555555','Garden Club',member],['66666666-6666-4666-8666-666666666666','Book Swap',sam]]) caches.set(id,{id,name,members,owner_id:cacheOwner,requires_approval:false,invite_token:`${id}.${'A'.repeat(43)}`})
    const item={id:itemId,cache_id:cacheId,cache_ids:[cacheId],owner_id:owner,owner_name:'Ryan',title:'Pressure washer',description:'Electric, 1800 psi. Comes with two nozzles. Happy to share!',is_consumable:false,quantity:null,available:true,unavailable_note:null,created_at:1,photo_version:null}
    items.set(itemId,item)
    items.set('77777777-7777-4777-8777-777777777777',{...item,id:'77777777-7777-4777-8777-777777777777',title:'Sourdough starter',is_consumable:true,quantity:3})
    const row={id:'88888888-8888-4888-8888-888888888888',cache_id:cacheId,cache_name:'Maple St',item_id:itemId,item_title:'Pressure washer',owner_id:owner,owner_name:'Ryan',requester_id:member,requester_name:'Priya',quantity:null,status:'approved',decision_reason:null,approval_message:'It is by my side gate.',decided_at:2,created_at:1}
    requests.set(row.id,row)
    contacts.set(owner,{kind:'messenger',value:'ryan.zhou',link:'https://m.me/ryan.zhou'})
    contacts.set(member,{kind:'whatsapp',value:'+14155550148',link:'https://wa.me/14155550148'})
    const screen=url.searchParams.get('screen')??'home', pages={home:'/',cache:`/caches/${cacheId}`,item:`/caches/${cacheId}/items/${itemId}`,requests:'/requests',account:'/account',signin:'/login',landing:'/'}
    response.setHeader('Set-Cookie',`ui_fixture=${screen==='signin'||screen==='landing'?'':owner}; HttpOnly; SameSite=Lax; Path=/`)
    response.writeHead(302,{Location:`${Object.hasOwn(pages,screen)?pages[screen]:'/'}?theme=${url.searchParams.get('theme')==='evening'?'evening':'sunny'}`});response.end();return
  }
  async function fixtureHtml(html) {
    const theme=url.searchParams.get('theme')
    if (theme!=='sunny' && theme!=='evening') return html
    const css=await readFile(fileURLToPath(new URL('../web/src/index.css',import.meta.url)),'utf8')
    const palettes=[...css.matchAll(/:root\s*\{([^}]+)\}/g)]
    const tokens=palettes[theme==='evening'?1:0]?.[1]??''
    // Force only fixture screenshots; production responds to the browser media query.
    return html.replace('</head>',`<style id="fixture-theme">html:root{${tokens};color-scheme:${theme==='evening'?'dark':'light'}}</style></head>`)
  }
  response.setHeader('Referrer-Policy', 'no-referrer')
  function json(value, status = 200) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(value))
  }
  if (path === '/__fixture/magic-link') {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
    response.end(`<!doctype html><html lang="en"><meta name="referrer" content="no-referrer"><title>Mock sign-in email</title><main><h1>Mock sign-in email</h1>${lastMagicLink ? `<a href="${lastMagicLink}">Open latest fixture sign-in link</a>` : '<p>Request a link from the login page first.</p>'}</main></html>`)
    return
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
    // The mock shares all fixture caches; real visibility is proved by D1 tests.
    const avatar = id => id===me?.id || caches.size>0 ? [...users.values()].find(user=>user.id===id)?.profile_photo_version ?? null : null
    const itemAvatar = item => ({...item,owner_photo_version:avatar(item.owner_id)})
    const requestAvatars = row => ({...row,owner_photo_version:avatar(row.owner_id),requester_photo_version:avatar(row.requester_id)})
    if (path === '/api/auth/sign-in/magic-link') {
      if (body.email === 'failure@example.test') { json({error:'email_unavailable'},502); return }
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
      const token = [...randomBytes(32)].map(byte => alphabet[byte % alphabet.length]).join('')
      magicLinks.set(token,{email:body.email,expiresAt:Date.now()+300000})
      lastMagicLink = `http://${request.headers.host}/auth/link#token=${token}`
      json({status:true})
      return
    }
    if (path === '/api/auth/magic-link/verify') {
      const link = magicLinks.get(body.token)
      magicLinks.delete(body.token)
      if (request.method !== 'POST' || !link || link.expiresAt <= Date.now()) { json({error:'invalid_magic_link'},400); return }
      me = users.get(link.email) ?? {id:randomUUID(),email:link.email,display_name:null}
      users.set(link.email,me)
      response.setHeader('Set-Cookie',`ui_fixture=${me.id}; HttpOnly; SameSite=Lax; Path=/`)
      json({success:true,callback_url:`http://${request.headers.host}/`})
      return
    }
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
    if (path === '/api/me/contact' || path === '/api/me/contact/preview') {
      if (!authenticated) { json({error:'unauthorized'},401); return }
      if (request.method === 'GET') { json({contact:contacts.get(me.id) ?? null}); return }
      if (request.method === 'DELETE') { contacts.delete(me.id); response.writeHead(204); response.end(); return }
      // Presentation fixture only; validation and membership races are proved in real D1 tests.
      const {kind} = body, value = typeof body.value==='string' ? body.value.trim() : ''
      const digits = value.replace(/^\+/, '')
      const links = {sms:`sms:+${digits}`,whatsapp:`https://wa.me/${digits}`,signal:`https://signal.me/#p/+${digits}`,messenger:`https://m.me/${value}`,instagram:`https://instagram.com/${value}`,email:`mailto:${value}`}
      if (!value || !Object.hasOwn(links,kind) || /[:/?#\s]/.test(value)) { json({error:'invalid_contact'},400); return }
      const contact={kind,value,link:links[kind]}
      if (path === '/api/me/contact') contacts.set(me.id,contact)
      json({contact}); return
    }
    const ownRequest = path.match(/^\/api\/me\/requests\/([^/]+)\/(approve|reject|contact)$/)
    if (ownRequest) {
      if (!authenticated) { json({error:'unauthorized'},401); return }
      const row=requests.get(ownRequest[1]), action=ownRequest[2]
      if (!row || (row.owner_id!==me.id && row.requester_id!==me.id)) { json({error:'not_found'},404); return }
      if (action==='contact') { if(row.status!=='approved') {json({error:'not_found'},404);return} json({contact:contacts.get(row.owner_id===me.id?row.requester_id:row.owner_id)??null}); return }
      if (row.owner_id!==me.id) { json({error:'not_found'},404); return }
      if (row.status!=='pending') { json({error:'request_not_pending'},409); return }
      if (action==='reject' && !body.reason?.trim()) { json({error:'invalid_reason'},400); return }
      if ([...(body.approval_message??'')].length>500) {json({error:'invalid_approval_message'},400);return}
      Object.assign(row,{status:action==='approve'?'approved':'rejected',decided_at:Date.now(),decision_reason:action==='reject'?body.reason.trim():null,approval_message:action==='approve'?body.approval_message?.trim()||null:null})
      const item=items.get(row.item_id)
      if (action==='approve' && row.quantity!==null) item.quantity-=row.quantity
      if (action==='approve' && body.mark_lent_out) {item.available=false;item.unavailable_note=body.unavailable_note??null}
      json(row); return
    }
    const profileRead=path.match(/^\/api\/users\/([^/]+)\/photo$/)
    if (path==='/api/me/photo' || profileRead) {
      if (!authenticated) { json({error:'not_found'},404); return }
      const ownerId=profileRead?.[1]??me.id
      if (profileRead && request.method!=='GET') { json({error:'method_not_allowed'},405); return }
      if (request.method==='POST') { profilePhotos.set(me.id,{bytes:raw,type:request.headers['content-type']}); me.profile_photo_version=randomUUID(); json(me); return }
      if (request.method==='DELETE') { profilePhotos.delete(me.id); me.profile_photo_version=null; response.writeHead(204,{'Cache-Control':'no-store'}); response.end(); return }
      const photo=profilePhotos.get(ownerId)
      if (!photo || !avatar(ownerId)) { json({error:'not_found'},404); return }
      response.writeHead(200,{'Content-Type':photo.type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}); response.end(photo.bytes); return
    }
    if (path === '/api/requests') {
      if (!authenticated) { json({error:'unauthorized'},401); return }
      json({requests:[...requests.values()].filter(row=>row.owner_id===me.id || row.requester_id===me.id).map(requestAvatars),unavailable_cache_ids:[],next_cursor:null})
      return
    }
    function libraryInfo(item) {
      const {cache_ids,...fields}=item
      const pending=[...requests.values()].filter(row=>row.item_id===item.id && row.status==='pending')
      return {...itemAvatar(fields),cache_id:null,caches:(cache_ids??[item.cache_id]).filter(id=>caches.has(id)).map(id=>({id,name:caches.get(id).name})),pending_count:pending.length,available_quantity:item.is_consumable?item.quantity-pending.reduce((sum,row)=>sum+(row.quantity??0),0):null}
    }
    if (path === '/api/me/items' || path.startsWith('/api/me/items/')) {
      if (!authenticated) { json({error:'unauthorized'},401); return }
      const match=path.match(/^\/api\/me\/items(?:\/([^/]+)(\/photo|\/attachments\/([^/]+))?)?$/)
      if (!match) { json({error:'not_found'},404); return }
      const itemId=match[1]
      if (!itemId && request.method==='GET') {
        json({items:[...items.values()].filter(item=>item.owner_id===me.id).map(libraryInfo),next_cursor:null}); return
      }
      if (!itemId && request.method==='POST') {
        if (!body.title?.trim()) { json({error:'invalid_title'},400); return }
        const item={id:randomUUID(),cache_id:null,cache_ids:[],owner_id:me.id,owner_name:me.display_name,title:body.title.trim(),description:body.description??null,is_consumable:body.is_consumable,quantity:body.is_consumable?body.quantity:null,available:true,unavailable_note:null,created_at:Date.now(),photo_version:null}
        items.set(item.id,item); json(libraryInfo(item),201); return
      }
      const item=items.get(itemId)
      if (!item || item.owner_id!==me.id) { json({error:'not_found'},404); return }
      if (match[3]) {
        if (!caches.has(match[3])) { json({error:'not_found'},404); return }
        item.cache_ids??=[item.cache_id].filter(Boolean)
        if (request.method==='PUT') item.cache_ids=[...new Set([...item.cache_ids,match[3]])]
        else if (request.method==='DELETE') {
          item.cache_ids=item.cache_ids.filter(id=>id!==match[3])
          for (const row of requests.values()) if (row.item_id===item.id && row.cache_id===match[3] && row.status==='pending') Object.assign(row,{status:'rejected',decision_reason:'item no longer shared in this cache',decided_at:Date.now()})
        }
        response.writeHead(204,{'Cache-Control':'no-store'}); response.end(); return
      }
      if (match[2]==='/photo') {
        if (request.method==='POST') { photos.set(item.id,{bytes:raw,type:request.headers['content-type']}); item.photo_version=randomUUID(); json(libraryInfo(item)); return }
        const photo=photos.get(item.id)
        if (!photo) { json({error:'not_found'},404); return }
        response.writeHead(200,{'Content-Type':photo.type,'Cache-Control':'private, no-store'}); response.end(photo.bytes); return
      }
      if (request.method==='DELETE') {
        items.delete(item.id); photos.delete(item.id)
        for (const row of [...requests.values()].filter(row=>row.item_id===item.id)) requests.delete(row.id)
        response.writeHead(204,{'Cache-Control':'no-store'}); response.end(); return
      }
      if (request.method==='PATCH') {
        const reserved=[...requests.values()].filter(row=>row.item_id===item.id && row.status==='pending').reduce((sum,row)=>sum+(row.quantity??0),0)
        if (body.quantity!==undefined && body.quantity!==null && body.quantity<reserved) { json({error:'quantity_reserved'},409); return }
        for (const field of ['title','description','quantity','available','unavailable_note']) if (body[field]!==undefined) item[field]=body[field]
      }
      json(libraryInfo(item)); return
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
      const memberRoute=path.match(/^\/api\/caches\/([^/]+)\/members\/([^/]+)$/)
      if (memberRoute && request.method==='DELETE') {
        const cache=caches.get(memberRoute[1])
        if (!cache || cache.owner_id!==me.id) { json({error:'not_found'},404); return }
        if (memberRoute[2]===cache.owner_id) { json({error:'owner_cannot_be_removed'},409); return }
        for (const item of [...items.values()].filter(item=>item.cache_id===cache.id && item.owner_id===memberRoute[2])) items.delete(item.id)
        response.writeHead(204,{'Cache-Control':'no-store'}); response.end(); return
      }
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
        if (!item || !(item.cache_ids??[item.cache_id]).includes(requestRoute[1])) { json({error:'not_found'},404); return }
        const queue=[...requests.values()].filter(row=>row.item_id===item.id)
        if (request.method==='GET') { json(queue.filter(row=>row.status==='pending' || row.owner_id===me.id || row.requester_id===me.id).map(requestAvatars)); return }
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
        if (!item || !(item.cache_ids??[item.cache_id]).includes(photoRoute[1])) { json({error:'not_found'},404); return }
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
        if (!itemId && request.method === 'GET') { json([...items.values()].filter(item=>(item.cache_ids??[item.cache_id]).includes(cacheId)).map(item=>({...itemAvatar(item),cache_id:cacheId}))); return }
        if (!itemId && request.method === 'POST') {
          if (!body.title?.trim() || [...body.title.trim()].length>120) { json({error:'invalid_title'},400); return }
          if (body.is_consumable && (!Number.isInteger(body.quantity) || body.quantity<0 || body.quantity>9999)) { json({error:'invalid_quantity'},400); return }
          const item={id:randomUUID(),cache_id:cacheId,cache_ids:[cacheId],owner_id:me.id,owner_name:me.display_name,title:body.title.trim(),description:body.description??null,is_consumable:body.is_consumable,quantity:body.is_consumable?body.quantity:null,available:true,unavailable_note:null,created_at:Date.now(),photo_version:null}
          items.set(item.id,item)
          json(item,201)
          return
        }
        const item=items.get(itemId)
        if (!item || !(item.cache_ids??[item.cache_id]).includes(cacheId)) { json({error:'not_found'},404); return }
        if (request.method === 'DELETE') {
          if (item.owner_id!==me.id) { json({error:'not_found'},404); return }
          items.delete(item.id); photos.delete(item.id)
          for (const row of [...requests.values()].filter(row=>row.item_id===item.id)) requests.delete(row.id)
          response.writeHead(204,{'Cache-Control':'no-store'}); response.end(); return
        }
        if (request.method === 'PATCH') {
          if (!body.title?.trim() || [...body.title.trim()].length>120) { json({error:'invalid_title'},400); return }
          if (item.is_consumable && (!Number.isInteger(body.quantity) || body.quantity<0 || body.quantity>9999)) { json({error:'invalid_quantity'},400); return }
          const reserved=[...requests.values()].filter(row=>row.item_id===item.id && row.status==='pending').reduce((sum,row)=>sum+(row.quantity??0),0)
          if (item.is_consumable && body.quantity<reserved) { json({error:'quantity_reserved'},409); return }
          item.title=body.title.trim()
          item.description=body.description??null
          item.quantity=item.is_consumable?body.quantity:null
        }
        json({...itemAvatar(item),cache_id:cacheId})
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
      json({...cache,members:(cache.members??[{user_id:me.id,display_name:me.display_name}]).map(member=>({...member,profile_photo_version:avatar(member.user_id)}))})
      return
    }
    json({error:'not_found'},404)
    return
  }
  if (vite) {
    if (!extname(path) && !path.startsWith('/@')) {
      const source=await readFile(fileURLToPath(new URL('../web/index.html',import.meta.url)),'utf8')
      response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'})
      response.end(await fixtureHtml(await vite.transformIndexHtml(request.url,source)));return
    }
    vite.middlewares(request,response,()=>{response.writeHead(404);response.end()}); return
  }
  try {
    const file = resolve(dist, '.' + path)
    if (file !== resolve(dist) && !file.startsWith(dist)) { response.writeHead(404); response.end(); return }
    const isAsset = path.startsWith('/assets/') || ['/favicon.svg','/favicon-32.png','/apple-touch-icon.png','/icon-192.png','/icon-512.png','/sw.js','/manifest.webmanifest'].includes(path)
    const data = await readFile(isAsset ? file : resolve(dist, 'index.html'))
    const types = {'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.html':'text/html','.webmanifest':'application/manifest+json'}
    response.writeHead(200, { 'Content-Type': types[extname(isAsset ? file : 'index.html')] ?? 'application/octet-stream' })
    response.end(isAsset ? data : await fixtureHtml(data.toString()))
  } catch { response.writeHead(404); response.end() }
})
if (process.env.UI_FIXTURE_DEV === '1') {
  const {createServer:createViteServer}=await import('../web/node_modules/vite/dist/node/index.js')
  vite=await createViteServer({root:fileURLToPath(new URL('../web/',import.meta.url)),configFile:fileURLToPath(new URL('../web/vite.config.ts',import.meta.url)),server:{middlewareMode:true,ws:{server}},appType:'spa'})
}
const port = Number(process.env.UI_FIXTURE_PORT ?? 4173)
server.listen(port, '127.0.0.1', () => console.log(`UI fixture ready at http://127.0.0.1:${port} (mock API, public code 123456)`))
