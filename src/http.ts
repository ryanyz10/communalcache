export class HttpError extends Error {
  constructor(public status: number, public code: string, public retryAfter?: number, public limit?: string) { super(code) }
}

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function requireOrigin(request: Request, origin: string) {
  if (request.headers.get('Origin') !== origin) throw new HttpError(403, 'invalid_origin')
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
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required')
    return body as Record<string, unknown>
  } catch { throw new HttpError(400, 'invalid_json') }
}
