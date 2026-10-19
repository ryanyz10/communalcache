import { createAuth, googleSignInEnabled, type DeliveryResult } from './auth'
import { magicCallbacks } from './magic-links'
import {
  attachItem, cacheDetail, cacheItems, cacheJoinRequests, createCache, createItem, createRequest,
  decideCacheJoin, decideRequest, deleteItem, deletePush, detachItem, getProfile, itemDetail,
  itemRequests, joinCache, invitePreview, libraryPage, listMyCaches, homeSummary, removeCacheMember,
  requestDetail, requestsPage, savePush, updateProfile, updateCache, updateItem, type Profile,
  ownContact, saveContact, removeContact, requestContact,
} from './db'
import { contactInput } from './contacts'
import { decisionInput, requestQuantity } from './requests'
import { itemChanges } from './items'
import { serveItemPhoto, serveProfilePhoto } from './photos'
import { sweepPhotoCleanup } from './cleanup'
import { HttpError, json, readBody, readOptionalBody, requireOrigin, securityHeaders } from './http'
import { consumeNotifications, sweepNotifications } from './notifications'
import { pushSubscription } from './push'
import { requireWriteLimit, type WriteRoute } from './rate-limit'
import { requireTurnstile } from './turnstile'
import { isCatCoat, type CatCoat } from '../shared/cat-coats'
import { serveAdmin } from './admin'
import { logMethod, logRoute } from './logging'

const authMethods: Record<string, string> = {
  '/api/auth/email-otp/send-verification-otp': 'POST',
  '/api/auth/sign-in/email-otp': 'POST',
  '/api/auth/sign-in/magic-link': 'POST',
  '/api/auth/sign-in/social': 'POST',
  '/api/auth/callback/google': 'GET',
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
  if (path === '/admin' || path.startsWith('/admin/') || path === '/api/admin' || path.startsWith('/api/admin/')) return serveAdmin(request, env)
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
    if ((path === '/api/auth/sign-in/social' || path === '/api/auth/callback/google') && !await googleSignInEnabled(env)) throw new HttpError(404, 'not_found')
    if (method === 'POST') {
      const body = await readBody(request)
      if (path.endsWith('/send-verification-otp') && body.type !== 'sign-in') throw new HttpError(400, 'invalid_type')
      if (path.endsWith('/sign-in/email-otp') && (typeof body.otp !== 'string' || !/^\d{6}$/.test(body.otp))) {
        throw new HttpError(400, 'invalid_otp')
      }
      if (path === '/api/auth/magic-link/verify') {
        if (typeof body.token !== 'string' || !/^[A-Za-z]{32}$/.test(body.token)) throw new HttpError(400, 'invalid_magic_link')
        const verificationUrl = new URL('/api/auth/magic-link/verify', env.APP_BASE_URL)
        verificationUrl.search = new URLSearchParams({ token: body.token, ...magicCallbacks(body, env.APP_BASE_URL) }).toString()
        // The plugin is GET-only. This internal HTTP adapter retains its D1 limiter;
        // only our Origin-checked POST is public, and no token enters an incoming URL.
        request = new Request(verificationUrl, { method: 'GET', headers: request.headers })
      } else {
        if (path === '/api/auth/sign-in/social' && (body.provider !== 'google' || body.idToken !== undefined)) throw new HttpError(400, 'invalid_provider')
        let input = body
        if (path === '/api/auth/sign-in/magic-link') input = { email: body.email, ...magicCallbacks(body, env.APP_BASE_URL) }
        if (path === '/api/auth/sign-in/social') input = { provider: 'google', disableRedirect: true, ...magicCallbacks(body, env.APP_BASE_URL) }
        request = new Request(request, { body: JSON.stringify(input) })
      }
    }
    if (path === '/api/auth/sign-in/magic-link' || path === '/api/auth/email-otp/send-verification-otp') {
      await requireTurnstile(request, env, 'signin')
    }
    const delivery: DeliveryResult = { status: 'not_called' }
    const response = await createAuth(env, delivery, path).handler(request)
    if ((path.endsWith('/send-verification-otp') || path === '/api/auth/sign-in/magic-link') && delivery.status === 'failed') {
      await response.body?.cancel()
      return json({ error: 'email_unavailable' }, 502)
    }
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'no-store')
    if (path === '/api/auth/callback/google') headers.set('Referrer-Policy', 'no-referrer')
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
    if (path.endsWith('/healthz')) return json({ status: 'ok' })
    return json({
      app_base_url: env.APP_BASE_URL,
      better_auth_url: env.BETTER_AUTH_URL,
      vapid_public_key: env.VAPID_PUBLIC_KEY,
      turnstile_site_key: env.TURNSTILE_SITE_KEY,
      google_sign_in: await googleSignInEnabled(env),
    })
  }

  const cacheRoute = path.match(/^\/api\/caches\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/invite\/rotate|\/invite\/preview|\/leave|\/join|\/join-requests(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(approve|reject))?)?$/i)
  const itemRoute = path.match(/^\/api\/caches\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/items(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/photo|\/requests)?)?$/i)
  const requestRoute = path.match(/^\/api\/caches\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/requests\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(approve|reject)$/i)
  const memberRoute = path.match(/^\/api\/caches\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/members\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  const libraryRoute = path.match(/^\/api\/me\/items(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/photo|\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?)?$/i)
  const profilePhotoRoute = path.match(/^\/api\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/photo$/i)
  const ownRequestRoute = path.match(/^\/api\/me\/requests\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(approve|reject|contact))?$/i)
  const ownContactRoute = path === '/api/me/contact' || path === '/api/me/contact/preview'
  // UUIDs are case-insensitive; SQLite text keys are not.
  for (const route of [cacheRoute, itemRoute, requestRoute, memberRoute, libraryRoute, ownRequestRoute, profilePhotoRoute]) {
    if (!route) continue
    for (let index = 1; index < route.length; index++) {
      if (route[index]) route[index] = route[index].toLowerCase()
    }
  }
  const ownPhoto = path === '/api/me/photo'
  const photoRoute = ownPhoto || !!profilePhotoRoute || itemRoute?.[3] === '/photo' || libraryRoute?.[2] === '/photo'
  if (
    path !== '/api/me' && path !== '/api/me/summary' && path !== '/api/caches' &&
    path !== '/api/requests' && path !== '/api/push/subscribe' &&
    !cacheRoute && !itemRoute && !requestRoute && !memberRoute && !libraryRoute &&
    !ownRequestRoute && !ownPhoto && !profilePhotoRoute && !ownContactRoute
  ) throw new HttpError(404, 'not_found')

  let allowedMethods: string[]
  if (cacheRoute?.[2] === '/invite/preview' || path === '/api/me/summary') allowedMethods = ['GET']
  else if (ownContactRoute) {
    if (path.endsWith('/preview')) allowedMethods = ['POST']
    else allowedMethods = ['GET', 'PUT', 'DELETE']
  } else if (ownRequestRoute && (!ownRequestRoute[2] || ownRequestRoute[2] === 'contact')) allowedMethods = ['GET']
  else if (ownPhoto) allowedMethods = ['GET', 'POST', 'DELETE']
  else if (profilePhotoRoute) allowedMethods = ['GET']
  else if (libraryRoute) {
    if (libraryRoute[3]) allowedMethods = ['PUT', 'DELETE']
    else if (libraryRoute[2] || !libraryRoute[1]) allowedMethods = ['GET', 'POST']
    else allowedMethods = ['GET', 'PATCH', 'DELETE']
  } else if (memberRoute) allowedMethods = ['DELETE']
  else if (path === '/api/push/subscribe') allowedMethods = ['POST', 'DELETE']
  else if (requestRoute || ownRequestRoute) allowedMethods = ['POST']
  else if (path === '/api/requests') allowedMethods = ['GET']
  else if (itemRoute) {
    if (itemRoute[3] || !itemRoute[2]) allowedMethods = ['GET', 'POST']
    else allowedMethods = ['GET', 'PATCH', 'DELETE']
  } else if (path === '/api/caches') allowedMethods = ['GET', 'POST']
  else if (cacheRoute?.[2] === '/join-requests') allowedMethods = ['GET']
  else if (cacheRoute?.[2]) allowedMethods = ['POST']
  else allowedMethods = ['GET', 'PATCH']
  if (!allowedMethods.includes(method)) throw new HttpError(405, 'method_not_allowed')

  const session = await createAuth(env).api.getSession({ headers: request.headers })
  const privatePhotoRead = photoRoute && method === 'GET'
  if (!session) throw new HttpError(privatePhotoRead ? 404 : 401, privatePhotoRead ? 'not_found' : 'unauthorized')
  const profile = await getProfile(env.DB, session.user.id)
  if (!profile) throw new HttpError(privatePhotoRead ? 404 : 401, privatePhotoRead ? 'not_found' : 'unauthorized')
  requireProfile(path, method, profile)

  let writeRoute: WriteRoute | null = null
  if (method === 'POST') {
    if (cacheRoute?.[2] === '/join') writeRoute = 'join'
    else if (cacheRoute?.[3]) writeRoute = 'join_decision'
    else if (itemRoute?.[3] === '/requests') writeRoute = 'request'
    else if (requestRoute || (ownRequestRoute && ownRequestRoute[2] !== 'contact')) writeRoute = 'request_decision'
  }
  if (writeRoute) {
    if (!session.user.emailVerified) throw new HttpError(401, 'unauthorized')
    await requireWriteLimit(env.DB, profile.id, writeRoute)
  }

  if (ownPhoto || profilePhotoRoute) {
    return serveProfilePhoto(request, env, profilePhotoRoute?.[1] ?? profile.id, profile.id)
  }
  if (ownContactRoute) {
    if (path.endsWith('/preview')) return json({ contact: contactInput(await readBody(request)) })
    if (method === 'GET') return json({ contact: await ownContact(env.DB, profile.id) })
    if (method === 'DELETE') {
      await readOptionalBody(request)
      await removeContact(env.DB, profile.id)
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
    }
    const contact = contactInput(await readBody(request))
    await saveContact(env.DB, profile.id, contact)
    return json({ contact })
  }
  if (ownRequestRoute && !ownRequestRoute[2]) return json(await requestDetail(env.DB, ownRequestRoute[1], profile.id))
  if (ownRequestRoute?.[2] === 'contact') return json({ contact: await requestContact(env.DB, ownRequestRoute[1], profile.id) })
  if (path === '/api/me/summary') return json(await homeSummary(env.DB, profile.id))

  if (path === '/api/me') {
    if (method === 'GET') return json(profile)
    const body = await readBody(request)
    const changes: { display_name?: string; cat_coat?: CatCoat | null } = {}
    if ('display_name' in body) {
      if (typeof body.display_name !== 'string' || !body.display_name.trim() || body.display_name.trim().length > 60) {
        throw new HttpError(400, 'invalid_display_name')
      }
      changes.display_name = body.display_name.trim()
    }
    if ('cat_coat' in body) {
      if (body.cat_coat !== null && !isCatCoat(body.cat_coat)) throw new HttpError(400, 'invalid_cat_coat')
      changes.cat_coat = body.cat_coat
    }
    if (!Object.keys(changes).length) throw new HttpError(400, 'invalid_display_name')
    return json(await updateProfile(env.DB, profile.id, changes))
  }
  if (memberRoute || cacheRoute?.[2] === '/leave') {
    await readOptionalBody(request)
    const notificationIds = await removeCacheMember(env.DB, memberRoute?.[1] ?? cacheRoute![1], profile.id, memberRoute?.[2] ?? profile.id, !memberRoute)
    await enqueueNotifications(env, notificationIds)
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  }
  if (path === '/api/requests') {
    return json(await requestsPage(env.DB, profile.id, new URL(request.url).searchParams.get('after')))
  }
  if (requestRoute || ownRequestRoute) {
    const requestId = requestRoute?.[2] ?? ownRequestRoute![1]
    const action = (requestRoute?.[3] ?? ownRequestRoute![2]) as 'approve' | 'reject'
    const input = decisionInput(await readBody(request), action)
    const result = await decideRequest(env.DB, requestId, profile.id, action, input, requestRoute?.[1] ?? null)
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
    const cacheId = itemRoute?.[1] ?? null
    const itemId = itemRoute?.[2] ?? libraryRoute?.[1]
    if (libraryRoute?.[3]) {
      await readOptionalBody(request)
      if (method === 'DELETE') await enqueueNotifications(env, await detachItem(env.DB, itemId!, libraryRoute[3], profile.id))
      else await attachItem(env.DB, itemId!, libraryRoute[3], profile.id)
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
    }
    if (method === 'DELETE') {
      await readOptionalBody(request)
      await enqueueNotifications(env, await deleteItem(env.DB, itemId!, profile.id, cacheId))
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
    }
    if (photoRoute) return serveItemPhoto(request, env, itemId!, profile.id, cacheId)
    if (!itemId && method === 'GET') {
      if (cacheId) return json(await cacheItems(env.DB, cacheId, profile.id))
      const params = new URL(request.url).searchParams
      return json(await libraryPage(env.DB, profile.id, params.get('after'), params.get('filter') ?? 'all'))
    }
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
    await requireTurnstile(request, env, 'create_cache')
    return json(await createCache(env.DB, profile.id, changes.name, changes.requires_approval ?? false), 201)
  }

  const cacheId = cacheRoute![1]
  const action = cacheRoute![2]
  if (action === '/invite/preview') return json(await invitePreview(env.DB, cacheId, profile.id, request.headers.get('X-Invite-Secret') ?? ''))
  if (action === '/join') {
    const body = await readBody(request)
    if (typeof body.secret !== 'string') throw new HttpError(400, 'invalid_secret')
    const result = await joinCache(env.DB, cacheId, profile.id, body.secret)
    await enqueueNotification(env, result.notificationId)
    return json(result.membership)
  }
  if (action === '/join-requests') return json(await cacheJoinRequests(env.DB, cacheId, profile.id))
  if (cacheRoute![3]) {
    await readOptionalBody(request)
    const result = await decideCacheJoin(env.DB, cacheId, profile.id, cacheRoute![3], cacheRoute![4] as 'approve' | 'reject')
    await enqueueNotification(env, result.notificationId)
    return json({ status: result.status })
  }
  if (action === '/invite/rotate') {
    await readOptionalBody(request)
    return json(await updateCache(env.DB, cacheId, profile.id, {}, true))
  }
  if (method === 'PATCH') return json(await updateCache(env.DB, cacheId, profile.id, cacheChanges(await readBody(request))))
  return json(await cacheDetail(env.DB, cacheId, profile.id))
}

async function enqueueNotification(env: Env, id: string | null) {
  if (!id) return
  try { await env.NOTIFICATIONS.send(id) }
  catch { console.error({ event: 'notification_enqueue_failed', count: 1 }) }
}

async function enqueueNotifications(env: Env, ids: string[]) {
  if (!ids.length) return
  try { await env.NOTIFICATIONS.sendBatch(ids.map(body => ({ body }))) }
  catch { console.error({ event: 'notification_enqueue_failed', count: ids.length }) }
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
    let failed = 0
    try { await consumeNotifications(batch, env) }
    catch {
      failed = 1
      // Do not let a binding/provider exception put private data into runtime logs.
      throw new Error('Queue processing incomplete')
    } finally { console.info({ event: 'queue', messages: batch.messages.length, failed_batches: failed }) }
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    // Recovery paths stay independent if one binding is temporarily unavailable.
    const results = await Promise.allSettled([sweepNotifications(env), sweepPhotoCleanup(env)])
    const failed = results.filter(result => result.status === 'rejected').length
    console.info({ event: 'scheduled', jobs: results.length, failed_jobs: failed })
    if (failed) throw new Error('Scheduled recovery incomplete')
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const started = Date.now()
    const route = logRoute(request.url)
    let status = 500
    try {
      const response = securityHeaders(await dispatch(request, env), env.APP_BASE_URL, new URL(request.url).pathname, request.url)
      status = response.status
      return response
    } catch (error) {
      let response: Response
      if (error instanceof HttpError) {
        response = json({ error: error.code, ...(error.limit ? { limit: error.limit } : {}) }, error.status)
        if (error.retryAfter !== undefined) response.headers.set('Retry-After', String(error.retryAfter))
      } else {
        // Error names/messages/stacks can contain credentials; use a fixed classification.
        console.error({ event: 'unhandled_error', route, name: 'Error' })
        response = json({ error: 'internal_error' }, 500)
      }
      const secured = securityHeaders(response, env.APP_BASE_URL, new URL(request.url).pathname, request.url)
      status = secured.status
      return secured
    } finally {
      console.info({ event: 'request', method: logMethod(request.method), route, status, ms: Math.max(0, Date.now() - started) })
    }
  },
} satisfies ExportedHandler<Env>
