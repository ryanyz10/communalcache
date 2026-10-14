import { createAuth, type DeliveryResult } from './auth'
import { getProfile, setDisplayName, type Profile } from './db'
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
  // Future features add their dispatch here; unknown paths never fall through to assets.
  if (path !== '/api/me') throw new HttpError(404, 'not_found')
  if (!['GET', 'PATCH'].includes(method)) throw new HttpError(405, 'method_not_allowed')
  const session = await createAuth(env).api.getSession({ headers: request.headers })
  if (!session) throw new HttpError(401, 'unauthorized')
  const profile = await getProfile(env.DB, session.user.id)
  if (!profile) throw new HttpError(401, 'unauthorized')
  requireProfile(path, method, profile)
  if (method === 'GET') return json(profile)
  const body = await readBody(request)
  if (typeof body.display_name !== 'string' || !body.display_name.trim() || body.display_name.trim().length > 60) {
    throw new HttpError(400, 'invalid_display_name')
  }
  return json(await setDisplayName(env.DB, profile.id, body.display_name.trim()))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await dispatch(request, env) }
    catch (error) {
      if (error instanceof HttpError) return json({ error: error.code }, error.status)
      // Auth/session/body errors must not log credentials or provider request bodies.
      return json({ error: 'internal_error' }, 500)
    }
  },
} satisfies ExportedHandler<Env>
