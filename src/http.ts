export class HttpError extends Error {
  constructor(public status: number, public code: string, public retryAfter?: number, public limit?: string) {
    super(code)
  }
}

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function securityHeaders(response: Response, appBaseUrl: string, path: string, requestUrl = appBaseUrl) {
  const headers = new Headers(response.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Content-Security-Policy', "frame-ancestors 'none'")
  // Resource restrictions remain report-only until real provider/device flows are proved.
  headers.set('Content-Security-Policy-Report-Only', "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'")
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), fullscreen=(), clipboard-write=(self), web-share=(self)')
  const privateReferrer = path.startsWith('/join/') || path === '/auth/link' || path === '/api/auth/callback/google'
  headers.set('Referrer-Policy', privateReferrer || headers.get('Referrer-Policy')?.toLowerCase() === 'no-referrer' ? 'no-referrer' : 'strict-origin-when-cross-origin')
  let https = false
  try {
    const origins = [new URL(appBaseUrl), new URL(requestUrl)]
    https = origins.every(origin => origin.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) && !origin.hostname.endsWith('.localhost'))
  } catch { /* Invalid configuration must not suppress baseline headers on an error. */ }
  if (https) headers.set('Strict-Transport-Security', 'max-age=31536000')
  else headers.delete('Strict-Transport-Security')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export function requireOrigin(request: Request, origin: string) {
  if (request.headers.get('Origin') !== origin) throw new HttpError(403, 'invalid_origin')
}

export async function readOptionalBody(request: Request): Promise<void> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() === 'application/json') {
    await readBody(request)
    return
  }
  const reader = request.body?.getReader({ mode: 'byob' })
  if (!reader) return
  try {
    const { done } = await reader.read(new Uint8Array(1))
    if (!done) {
      await reader.cancel()
      throw new HttpError(415, 'json_required')
    }
  } finally { reader.releaseLock() }
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
    throw new HttpError(415, 'json_required')
  }
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, 'invalid_json')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 16_384) {
        await reader.cancel()
        throw new HttpError(413, 'body_too_large')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required')
    return body as Record<string, unknown>
  } catch { throw new HttpError(400, 'invalid_json') }
}
