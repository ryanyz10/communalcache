import { HttpError } from './http'

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
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const jpeg = size >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[size - 2] === 0xff && bytes[size - 1] === 0xd9
  const png = size >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  const webp = size >= 16 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(String.fromCharCode(...bytes.subarray(12, 16)))
  const sniffed = jpeg ? 'image/jpeg' : png ? 'image/png' : webp ? 'image/webp' : null
  if (sniffed !== contentType) throw new HttpError(415, 'invalid_photo_type')
  return { bytes, contentType }
}
