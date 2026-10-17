import { createAuth } from './auth'
import { verifyAccessJwt } from './access'
import { HttpError, json, readBody, requireOrigin } from './http'
import { adminCachePlan, adminCaches, adminFailedOutbox, adminOverview, adminUserPlan, adminUsers, type AdminActor } from './db/admin'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function requireAdmin(request: Request, env: Env): Promise<AdminActor> {
  try {
    const ids = env.ADMIN_USER_IDS?.split(',').map(id => id.trim()) ?? []
    if (!ids.length || ids.length > 32 || ids.some(id => !uuid.test(id))) throw new Error('Missing admin allowlist')
    await verifyAccessJwt(request, env)
    // Better Auth verifies the caller's cookie and current D1 session, never an Access email/header identity.
    const session = await createAuth(env).api.getSession({ headers: request.headers })
    if (!session || !ids.includes(session.user.id)) throw new Error('Not an administrator')
    return { userId: session.user.id, sessionToken: session.session.token }
  } catch { throw new HttpError(404, 'not_found') }
}

export async function serveAdmin(request: Request, env: Env) {
  const actor = await requireAdmin(request, env)
  const url = new URL(request.url), path = url.pathname, method = request.method
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) requireOrigin(request, env.APP_BASE_URL)
  if (path === '/admin' || path === '/admin/') {
    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'method_not_allowed')
    const response = await env.ASSETS.fetch(request)
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'no-store')
    headers.set('Referrer-Policy', 'no-referrer')
    return new Response(response.body, { status: response.status, headers })
  }
  const planRoute = path.match(/^\/api\/admin\/(caches|users)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/plan$/i)
  if (planRoute) {
    if (method !== 'PATCH') throw new HttpError(405, 'method_not_allowed')
    const body = await readBody(request)
    if (typeof body.plan !== 'string' || !['free', 'plus'].includes(body.plan)) throw new HttpError(400, 'invalid_plan')
    if (planRoute[1].toLowerCase() === 'caches') await adminCachePlan(env.DB, actor, planRoute[2].toLowerCase(), body.plan)
    else await adminUserPlan(env.DB, actor, planRoute[2].toLowerCase(), body.plan)
    return json({ id: planRoute[2].toLowerCase(), plan: body.plan })
  }
  if (!['/api/admin/overview', '/api/admin/caches', '/api/admin/users', '/api/admin/failed-outbox'].includes(path)) throw new HttpError(404, 'not_found')
  if (method !== 'GET') throw new HttpError(405, 'method_not_allowed')
  const after = url.searchParams.get('after')
  if (after !== null && !uuid.test(after)) throw new HttpError(400, 'invalid_cursor')
  if (path === '/api/admin/overview') return json(await adminOverview(env.DB, actor))
  if (path === '/api/admin/caches') return json(await adminCaches(env.DB, actor, after?.toLowerCase() ?? null))
  if (path === '/api/admin/users') return json(await adminUsers(env.DB, actor, after?.toLowerCase() ?? null))
  return json(await adminFailedOutbox(env.DB, actor, after?.toLowerCase() ?? null))
}
