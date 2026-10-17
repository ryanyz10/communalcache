import { finishItemPhoto, finishProfilePhoto, getProfile, itemDetail, profilePhotoKey, readItem, removeProfilePhoto } from './db'
import { HttpError, json } from './http'
import { requireWriteLimit } from './rate-limit'

export async function serveItemPhoto(request: Request, env: Env, itemId: string, userId: string, cacheId: string | null = null) {
  const authorizedItem = await readItem(env.DB, itemId, userId, cacheId, request.method === 'POST')
  if (request.method === 'GET') {
    if (!authorizedItem.photo_path) throw new HttpError(404, 'not_found')
    const object = await env.BUCKET.get(authorizedItem.photo_path)
    if (!object) throw new HttpError(404, 'not_found')
    return new Response(object.body, { headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(object.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } })
  }
  await requireWriteLimit(env.DB, userId, 'photo_upload')
  const key = `${userId}/${itemId}/${crypto.randomUUID()}`
  const { bytes, contentType } = await readPhoto(request)
  let attached = false
  try {
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType } })
    attached = await finishItemPhoto(env.DB, itemId, userId, key, true, cacheId)
  } catch (error) {
    await finishItemPhoto(env.DB, itemId, userId, key, false, cacheId)
    throw error
  }
  if (!attached) throw new HttpError(404, 'not_found')
  return json(await itemDetail(env.DB, itemId, userId, cacheId))
}

export async function serveProfilePhoto(request: Request, env: Env, ownerId: string, readerId: string) {
  if (request.method === 'GET') {
    const key = await profilePhotoKey(env.DB, ownerId, readerId)
    const object = await env.BUCKET.get(key)
    if (!object) throw new HttpError(404, 'not_found')
    return new Response(object.body, { headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(object.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } })
  }
  if (ownerId !== readerId) throw new HttpError(404, 'not_found')
  if (request.method === 'DELETE') {
    await removeProfilePhoto(env.DB, readerId)
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  }
  await requireWriteLimit(env.DB, readerId, 'photo_upload')
  const { bytes, contentType } = await readPhoto(request)
  const key = `users/${readerId}/${crypto.randomUUID()}`
  let attached = false
  try {
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType } })
    attached = await finishProfilePhoto(env.DB, readerId, key, true)
  } catch (error) {
    await finishProfilePhoto(env.DB, readerId, key, false)
    throw error
  }
  if (!attached) throw new HttpError(404, 'not_found')
  return json(await getProfile(env.DB, readerId))
}

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024

export async function readPhoto(request: Request) {
  const contentType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()
  if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new HttpError(415, 'invalid_photo_type')
  if (Number(request.headers.get('Content-Length')) > MAX_PHOTO_BYTES) throw new HttpError(413, 'photo_too_large')
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, 'invalid_photo')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PHOTO_BYTES) {
        await reader.cancel()
        throw new HttpError(413, 'photo_too_large')
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
  const jpeg = size >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[size - 2] === 0xff && bytes[size - 1] === 0xd9
  const png = size >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  const webp = size >= 16 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(String.fromCharCode(...bytes.subarray(12, 16)))
  let sniffed: string | null = null
  if (jpeg) sniffed = 'image/jpeg'
  else if (png) sniffed = 'image/png'
  else if (webp) sniffed = 'image/webp'
  if (sniffed !== contentType) throw new HttpError(415, 'invalid_photo_type')
  return { bytes, contentType }
}
