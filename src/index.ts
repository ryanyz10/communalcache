import { createAuth, type DeliveryResult } from './auth'
import { displayNames, getProfile, listMyCaches, setDisplayName, type Profile } from './db'
import { sweepCacheSync } from './sync'
import { HttpError, json, readBody, requireOrigin } from './http'
export { Cache } from './cache'

const authMethods: Record<string, string> = {
  '/api/auth/email-otp/send-verification-otp': 'POST',
  '/api/auth/sign-in/email-otp': 'POST',
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
    if (!path.startsWith('/join/')) return response
    const headers = new Headers(response.headers)
    headers.set('Referrer-Policy', 'no-referrer')
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
      request = new Request(request, { body: JSON.stringify(body) })
    }
    const delivery: DeliveryResult = { status: 'not_called' }
    const response = await createAuth(env, delivery, path).handler(request)
    if (path.endsWith('/send-verification-otp') && delivery.status === 'failed') {
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
  const cacheRoute = path.match(/^\/api\/caches\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/invite\/rotate|\/join|\/join-requests(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(approve|reject))?)?$/i)
  const itemRoute = path.match(/^\/api\/caches\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/items(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$/i)
  if (path !== '/api/me' && path !== '/api/caches' && !cacheRoute && !itemRoute) throw new HttpError(404, 'not_found')
  const methods = itemRoute ? (itemRoute[2] ? ['GET', 'PATCH'] : ['GET', 'POST']) : path === '/api/caches' ? ['GET', 'POST'] : cacheRoute?.[2] === '/join-requests' ? ['GET'] : cacheRoute?.[2] ? ['POST'] : ['GET', 'PATCH']
  if (!methods.includes(method)) throw new HttpError(405, 'method_not_allowed')
  const session = await createAuth(env).api.getSession({ headers: request.headers })
  if (!session) throw new HttpError(401, 'unauthorized')
  const profile = await getProfile(env.DB, session.user.id)
  if (!profile) throw new HttpError(401, 'unauthorized')
  requireProfile(path, method, profile)
  if (path === '/api/me') {
    if (method === 'GET') return json(profile)
    const body = await readBody(request)
    if (typeof body.display_name !== 'string' || !body.display_name.trim() || body.display_name.trim().length > 60) throw new HttpError(400, 'invalid_display_name')
    return json(await setDisplayName(env.DB, profile.id, body.display_name.trim()))
  }
  if (path === '/api/caches' && method === 'GET') return json((await listMyCaches(env.DB, profile.id)).results)
  try {
    if (path === '/api/caches') {
      const changes = cacheChanges(await readBody(request))
      if (changes.name === undefined) throw new HttpError(400, 'invalid_name')
      const id = crypto.randomUUID()
      return json(await env.CACHES.get(env.CACHES.idFromName(id)).create(id, profile.id, changes.name, changes.requires_approval ?? false), 201)
    }
    if (itemRoute) {
      const stub = env.CACHES.get(env.CACHES.idFromName(itemRoute[1]))
      const itemId = itemRoute[2]
      if (!itemId && method === 'GET') {
        const items = await stub.listItems(profile.id)
        const names = await displayNames(env.DB, [...new Set(items.map(item => item.owner_id))])
        return json(items.map(item => ({ ...item, owner_name: names.get(item.owner_id) ?? null })))
      }
      const item = method === 'POST' ? await stub.createItem(profile.id, await readBody(request))
        : method === 'PATCH' ? await stub.updateItem(profile.id, itemId, await readBody(request))
        : await stub.itemDetail(profile.id, itemId)
      const names = await displayNames(env.DB, [item.owner_id])
      return json({ ...item, owner_name: names.get(item.owner_id) ?? null }, method === 'POST' ? 201 : 200)
    }
    const stub = env.CACHES.get(env.CACHES.idFromName(cacheRoute![1]))
    const action = cacheRoute![2]
    if (action === '/join') {
      const body = await readBody(request)
      if (typeof body.secret !== 'string') throw new HttpError(400, 'invalid_secret')
      return json(await stub.join(profile.id, body.secret))
    }
    if (action === '/join-requests') {
      const requests = await stub.joinRequests(profile.id)
      const names = await displayNames(env.DB, requests.map(member => member.user_id))
      return json(requests.map(member => ({ ...member, display_name: names.get(member.user_id) ?? null })))
    }
    if (cacheRoute![3]) {
      if (request.body) await readBody(request)
      return json(await stub.decideJoin(profile.id, cacheRoute![3], cacheRoute![4] as 'approve' | 'reject'))
    }
    if (action === '/invite/rotate') {
      if (request.body) await readBody(request)
      return json(await stub.rotateInvite(profile.id))
    }
    if (method === 'PATCH') return json(await stub.update(profile.id, cacheChanges(await readBody(request))))
    const detail = await stub.detail(profile.id)
    const names = await displayNames(env.DB, detail.members.map(member => member.user_id))
    return json({ ...detail, members: detail.members.map(member => ({ ...member, display_name: names.get(member.user_id) ?? null })) })
  } catch (error) {
    // RPC recreates Error objects; use only the stable messages defined by cache RPCs.
    if (error instanceof Error && error.message === 'not_found') throw new HttpError(404, 'not_found')
    if (error instanceof Error && error.message === 'cache_exists') throw new HttpError(409, 'cache_exists')
    if (error instanceof Error && error.message === 'member_removed') throw new HttpError(403, 'member_removed')
    if (error instanceof Error && error.message === 'join_not_pending') throw new HttpError(409, 'join_not_pending')
    if (error instanceof Error && error.message === 'quantity_reserved') throw new HttpError(409, 'quantity_reserved')
    if (error instanceof Error && ['invalid_title', 'invalid_description', 'invalid_is_consumable', 'immutable_is_consumable', 'invalid_quantity', 'invalid_json'].includes(error.message)) throw new HttpError(400, error.message)
    throw error
  }
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
  async scheduled(_controller: ScheduledController, env: Env) {
    await sweepCacheSync(env)
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await dispatch(request, env) }
    catch (error) {
      if (error instanceof HttpError) return json({ error: error.code }, error.status)
      // Auth/session/body errors must not log credentials or provider request bodies.
      return json({ error: 'internal_error' }, 500)
    }
  },
} satisfies ExportedHandler<Env>
