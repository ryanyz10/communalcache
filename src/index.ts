import { createAuth, type DeliveryResult } from './auth'
import { magicCallbacks } from './magic-links'
import { attachItem, cacheDetail, cacheItems, cacheJoinRequests, createCache, createItem, createRequest, decideCacheJoin, decideRequest, deleteItem, deletePush, detachItem, getProfile, itemDetail, itemRequests, joinCache, libraryPage, listMyCaches, removeCacheMember, requestsPage, savePush, setDisplayName, updateCache, updateItem, type Profile } from './db'
import { decisionInput, requestQuantity } from './requests'
import { itemChanges } from './items'
import { serveItemPhoto, serveProfilePhoto } from './photos'
import { sweepPhotoCleanup } from './cleanup'
import { HttpError, json, readBody, requireOrigin } from './http'
import { consumeNotifications, sweepNotifications } from './notifications'
import { pushSubscription } from './push'
import { requireWriteLimit, type WriteRoute } from './rate-limit'

const authMethods: Record<string, string> = {
  '/api/auth/email-otp/send-verification-otp': 'POST',
  '/api/auth/sign-in/email-otp': 'POST',
  '/api/auth/sign-in/magic-link': 'POST',
  '/api/auth/magic-link/verify': 'POST',
  '/api/auth/get-session': 'GET',
  '/api/auth/sign-out': 'POST',
}

export function requireProfile(path: string, method: string, profile: Profile) {
  if (path.startsWith('/api/auth/') || path.startsWith('/api/push/') || (path === '/api/me' && method === 'PATCH')) return
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && !profile.display_name) {
    throw new HttpError(409, 'profile_incomplete')
  }
}

async function dispatch(request: Request, env: Env) {
  const path = new URL(request.url).pathname
  const method = request.method
  if (path !== '/api' && !path.startsWith('/api/')) {
    const response = await env.ASSETS.fetch(request)
    if (!path.startsWith('/join/') && path !== '/auth/link') return response
    const headers = new Headers(response.headers)
    headers.set('Referrer-Policy', 'no-referrer')
    if (path === '/auth/link') headers.set('Cache-Control', 'no-store')
    return new Response(response.body, { status: response.status, headers })
  }
  if (method === 'OPTIONS') return new Response(null, { status: 204 })
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) requireOrigin(request, env.APP_BASE_URL)
  if (path.startsWith('/api/auth/')) {
    if (!authMethods[path]) throw new HttpError(404, 'not_found')
    if (method !== authMethods[path]) throw new HttpError(405, 'method_not_allowed')
    if (method === 'POST') {
      const body = await readBody(request)
      if (path.endsWith('/send-verification-otp') && body.type !== 'sign-in') throw new HttpError(400, 'invalid_type')
      if (path.endsWith('/sign-in/email-otp') && (typeof body.otp !== 'string' || !/^\d{6}$/.test(body.otp))) throw new HttpError(400, 'invalid_otp')
      if (path === '/api/auth/magic-link/verify') {
        if (typeof body.token !== 'string' || !/^[A-Za-z]{32}$/.test(body.token)) throw new HttpError(400, 'invalid_magic_link')
        const url = new URL('/api/auth/magic-link/verify', env.APP_BASE_URL)
        url.search = new URLSearchParams({ token: body.token, ...magicCallbacks(body, env.APP_BASE_URL) }).toString()
        // The plugin is GET-only. This internal HTTP adapter retains its D1 limiter;
        // only our Origin-checked POST is public, and no token enters an incoming URL.
        request = new Request(url, { method: 'GET', headers: request.headers })
      } else {
        const input = path === '/api/auth/sign-in/magic-link' ? { email: body.email, ...magicCallbacks(body, env.APP_BASE_URL) } : body
        request = new Request(request, { body: JSON.stringify(input) })
      }
    }
    const delivery: DeliveryResult = { status: 'not_called' }
    const response = await createAuth(env, delivery, path).handler(request)
    if ((path.endsWith('/send-verification-otp') || path === '/api/auth/sign-in/magic-link') && delivery.status === 'failed') {
      await response.body?.cancel()
      return json({ error: 'email_unavailable' }, 502)
    }
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'no-store')
    // Unexpected auth failures may have empty bodies; keep API errors JSON.
    if (response.status >= 500) {
      await response.body?.cancel()
      return json({ error: 'auth_unavailable' }, 503)
    }
    if (path === '/api/auth/magic-link/verify' && response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      // 1.7.7 sets a session cookie only on a successful verification redirect.
      if (!headers.has('Set-Cookie')) return json({ error: 'invalid_magic_link' }, 400)
      const destination = headers.get('Location')!
      if (new URL(destination).origin !== env.APP_BASE_URL) throw new HttpError(400, 'invalid_callback')
      headers.delete('Location')
      headers.set('Content-Type', 'application/json')
      return new Response(JSON.stringify({ success: true, callback_url: destination }), { headers })
    }
    return new Response(response.body, { status: response.status, headers })
  }
  if (path === '/api/healthz' || path === '/api/config') {
    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'method_not_allowed')
    return path.endsWith('/healthz') ? json({ status: 'ok' }) : json({
      app_base_url: env.APP_BASE_URL,
      better_auth_url: env.BETTER_AUTH_URL,
      vapid_public_key: env.VAPID_PUBLIC_KEY,
    })
  }
  const cacheRoute = path.match(/^\/api\/caches\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/invite\/rotate|\/leave|\/join|\/join-requests(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(approve|reject))?)?$/i)
  const itemRoute = path.match(/^\/api\/caches\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/items(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/photo|\/requests)?)?$/i)
  const requestRoute = path.match(/^\/api\/caches\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/requests\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(approve|reject)$/i)
  const memberRoute = path.match(/^\/api\/caches\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/members\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  const libraryRoute = path.match(/^\/api\/me\/items(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/photo|\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?)?$/i)
  const profilePhotoRoute = path.match(/^\/api\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/photo$/i)
  const ownRequestRoute = path.match(/^\/api\/me\/requests\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(approve|reject)$/i)
  // UUIDs are case-insensitive; SQLite text keys are not.
  for (const route of [cacheRoute, itemRoute, requestRoute, memberRoute, libraryRoute, ownRequestRoute, profilePhotoRoute]) {
    if (route) for (let index = 1; index < route.length; index++) if (route[index]) route[index] = route[index].toLowerCase()
  }
  const ownPhoto = path === '/api/me/photo'
  const photoRoute = ownPhoto || !!profilePhotoRoute || itemRoute?.[3] === '/photo' || libraryRoute?.[2] === '/photo'
  if (path !== '/api/me' && path !== '/api/caches' && path !== '/api/requests' && path !== '/api/push/subscribe' && !cacheRoute && !itemRoute && !requestRoute && !memberRoute && !libraryRoute && !ownRequestRoute && !ownPhoto && !profilePhotoRoute) throw new HttpError(404, 'not_found')
  const methods = ownPhoto ? ['GET','POST','DELETE'] : profilePhotoRoute ? ['GET'] : libraryRoute ? (libraryRoute[3] ? ['PUT', 'DELETE'] : libraryRoute[2] || !libraryRoute[1] ? ['GET', 'POST'] : ['GET', 'PATCH', 'DELETE'])
    : memberRoute ? ['DELETE'] : path === '/api/push/subscribe' ? ['POST', 'DELETE'] : requestRoute || ownRequestRoute ? ['POST'] : path === '/api/requests' ? ['GET'] : itemRoute ? (itemRoute[3] || !itemRoute[2] ? ['GET', 'POST'] : ['GET', 'PATCH', 'DELETE']) : path === '/api/caches' ? ['GET', 'POST'] : cacheRoute?.[2] === '/join-requests' ? ['GET'] : cacheRoute?.[2] ? ['POST'] : ['GET', 'PATCH']
  if (!methods.includes(method)) throw new HttpError(405, 'method_not_allowed')
  const session = await createAuth(env).api.getSession({ headers: request.headers })
  if (!session) throw new HttpError(photoRoute && method === 'GET' ? 404 : 401, photoRoute && method === 'GET' ? 'not_found' : 'unauthorized')
  const profile = await getProfile(env.DB, session.user.id)
  if (!profile) throw new HttpError(photoRoute && method === 'GET' ? 404 : 401, photoRoute && method === 'GET' ? 'not_found' : 'unauthorized')
  requireProfile(path, method, profile)
  const writeRoute: WriteRoute | null = method !== 'POST' ? null
    : cacheRoute?.[2] === '/join' ? 'join'
    : cacheRoute?.[3] ? 'join_decision'
    : itemRoute?.[3] === '/requests' ? 'request'
    : requestRoute || ownRequestRoute ? 'request_decision' : null
  if (writeRoute) {
    if (!session.user.emailVerified) throw new HttpError(401, 'unauthorized')
    await requireWriteLimit(env.DB, profile.id, writeRoute)
  }
  if (ownPhoto || profilePhotoRoute) return serveProfilePhoto(request,env,profilePhotoRoute?.[1] ?? profile.id,profile.id)
  if (path === '/api/me') {
    if (method === 'GET') return json(profile)
    const body = await readBody(request)
    if (typeof body.display_name !== 'string' || !body.display_name.trim() || body.display_name.trim().length > 60) throw new HttpError(400, 'invalid_display_name')
    return json(await setDisplayName(env.DB, profile.id, body.display_name.trim()))
  }
  if (memberRoute || cacheRoute?.[2] === '/leave') {
    if (request.body) await readBody(request)
    const ids = await removeCacheMember(env.DB, memberRoute?.[1] ?? cacheRoute![1], profile.id, memberRoute?.[2] ?? profile.id, !memberRoute)
    await enqueueNotifications(env, ids)
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  }
  if (path === '/api/requests') return json(await requestsPage(env.DB, profile.id, new URL(request.url).searchParams.get('after')))
  if (requestRoute || ownRequestRoute) {
    const requestId = requestRoute?.[2] ?? ownRequestRoute![1]
    const action = (requestRoute?.[3] ?? ownRequestRoute![2]) as 'approve' | 'reject'
    const result = await decideRequest(env.DB, requestId, profile.id, action, decisionInput(await readBody(request), action), requestRoute?.[1] ?? null)
    await enqueueNotification(env, result.notificationId)
    return json(result.request)
  }
  if (itemRoute?.[3] === '/requests') {
    if (method === 'GET') return json(await itemRequests(env.DB, itemRoute[2], itemRoute[1], profile.id))
    const result = await createRequest(env.DB, itemRoute[2], itemRoute[1], profile.id, requestQuantity(await readBody(request)))
    await enqueueNotification(env, result.notificationId)
    return json(result.request, 201)
  }
  if (libraryRoute || itemRoute) {
    const cacheId = itemRoute?.[1] ?? null, itemId = itemRoute?.[2] ?? libraryRoute?.[1]
    if (libraryRoute?.[3]) {
      if (request.body) await readBody(request)
      if (method === 'DELETE') await enqueueNotifications(env, await detachItem(env.DB, itemId!, libraryRoute[3], profile.id))
      else await attachItem(env.DB, itemId!, libraryRoute[3], profile.id)
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
    }
    if (method === 'DELETE') {
      if (request.body) await readBody(request)
      await enqueueNotifications(env, await deleteItem(env.DB, itemId!, profile.id, cacheId))
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
    }
    if (photoRoute) return serveItemPhoto(request, env, itemId!, profile.id, cacheId)
    if (!itemId && method === 'GET') return json(cacheId ? await cacheItems(env.DB, cacheId, profile.id) : await libraryPage(env.DB, profile.id, new URL(request.url).searchParams.get('after')))
    if (method === 'POST') return json(await createItem(env.DB, profile.id, itemChanges(await readBody(request), true), cacheId), 201)
    if (method === 'PATCH') return json(await updateItem(env.DB, itemId!, profile.id, itemChanges(await readBody(request), false), cacheId))
    return json(await itemDetail(env.DB, itemId!, profile.id, cacheId))
  }
  if (path === '/api/caches' && method === 'GET') return json((await listMyCaches(env.DB, profile.id)).results)
  if (path === '/api/push/subscribe') {
    const body = await readBody(request)
    if (method === 'DELETE') {
      if (typeof body.endpoint !== 'string' || !body.endpoint || body.endpoint.length > 2048) throw new HttpError(400, 'invalid_push_endpoint')
      await deletePush(env.DB, profile.id, body.endpoint)
    } else {
      const subscription = await pushSubscription(body).catch(error => {
        if (error instanceof Error && ['invalid_push_endpoint', 'invalid_push_keys'].includes(error.message)) throw new HttpError(400, error.message)
        throw error
      })
      const result = await savePush(env.DB, profile.id, subscription)
      if (result.meta.changes === 0) throw new HttpError(409, 'push_limit')
    }
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  }
  if (path === '/api/caches') {
    const changes = cacheChanges(await readBody(request))
    if (changes.name === undefined) throw new HttpError(400, 'invalid_name')
    return json(await createCache(env.DB, profile.id, changes.name, changes.requires_approval ?? false), 201)
  }
  const cacheId = cacheRoute![1], action = cacheRoute![2]
  if (action === '/join') {
    const body = await readBody(request)
    if (typeof body.secret !== 'string') throw new HttpError(400, 'invalid_secret')
    const result = await joinCache(env.DB, cacheId, profile.id, body.secret)
    await enqueueNotification(env, result.notificationId)
    return json(result.membership)
  }
  if (action === '/join-requests') return json(await cacheJoinRequests(env.DB, cacheId, profile.id))
  if (cacheRoute![3]) {
    if (request.body) await readBody(request)
    const result = await decideCacheJoin(env.DB, cacheId, profile.id, cacheRoute![3], cacheRoute![4] as 'approve' | 'reject')
    await enqueueNotification(env, result.notificationId)
    return json({ status: result.status })
  }
  if (action === '/invite/rotate') {
    if (request.body) await readBody(request)
    return json(await updateCache(env.DB, cacheId, profile.id, {}, true))
  }
  if (method === 'PATCH') return json(await updateCache(env.DB, cacheId, profile.id, cacheChanges(await readBody(request))))
  return json(await cacheDetail(env.DB, cacheId, profile.id))
}

async function enqueueNotification(env: Env, id: string | null) {
  if (!id) return
  try { await env.NOTIFICATIONS.send(id) }
  catch { console.error('Notification enqueue failed; durable outbox retained') }
}

async function enqueueNotifications(env: Env, ids: string[]) {
  if (!ids.length) return
  try { await env.NOTIFICATIONS.sendBatch(ids.map(body => ({ body }))) }
  catch { console.error('Notification enqueue failed; durable outbox retained') }
}

function cacheChanges(body: Record<string, unknown>) {
  const changes: { name?: string; requires_approval?: boolean } = {}
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || [...body.name.trim()].length > 60) throw new HttpError(400, 'invalid_name')
    changes.name = body.name.trim()
  }
  if (body.requires_approval !== undefined) {
    if (typeof body.requires_approval !== 'boolean') throw new HttpError(400, 'invalid_requires_approval')
    changes.requires_approval = body.requires_approval
  }
  if (changes.name === undefined && changes.requires_approval === undefined) throw new HttpError(400, 'invalid_json')
  return changes
}

export default {
  async queue(batch: MessageBatch<unknown>, env: Env) {
    await consumeNotifications(batch, env)
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    // Recovery paths stay independent if one binding is temporarily unavailable.
    const results = await Promise.allSettled([sweepNotifications(env), sweepPhotoCleanup(env)])
    if (results.some(result => result.status === 'rejected')) throw new Error('Scheduled recovery incomplete')
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await dispatch(request, env) }
    catch (error) {
      if (error instanceof HttpError) {
        const response = json({ error: error.code, ...(error.limit ? { limit: error.limit } : {}) }, error.status)
        if (error.retryAfter !== undefined) response.headers.set('Retry-After', String(error.retryAfter))
        return response
      }
      // Auth/session/body errors must not log credentials or provider request bodies.
      return json({ error: 'internal_error' }, 500)
    }
  },
} satisfies ExportedHandler<Env>
