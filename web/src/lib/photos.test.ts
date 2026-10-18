import { afterEach, expect, it, vi } from 'vitest'
import { MAX_RESIZED_PHOTO_BYTES, PHOTO_READ_ERROR, PHOTO_TOO_LARGE_ERROR, resizePhoto, uploadPhoto, uploadProfilePhoto } from './photos'
import { ApiError, errorMessage } from './api'

const file = new File(['fixture'], 'photo.png', { type: 'image/png' })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function canvasFixture(width = 3200, height = 2400) {
  const encoded = new Blob(['encoded JPEG'], { type: 'image/jpeg' })
  const image = { width, height, close: vi.fn() }
  const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => context as typeof context | null), toBlob: vi.fn((callback: BlobCallback, _type: string, _quality: number) => callback(encoded)) }
  vi.stubGlobal('createImageBitmap', vi.fn(async () => image))
  vi.stubGlobal('document', { createElement: vi.fn((tag: string) => { expect(tag).toBe('canvas'); return canvas }) })
  return { encoded, image, canvas, context }
}

it('resizes the longest side to 1600, paints transparency white and encodes JPEG without upscaling', async () => {
  const { encoded, image, canvas, context } = canvasFixture()
  expect(await resizePhoto(file)).toBe(encoded)
  expect(canvas.width).toBe(1600)
  expect(canvas.height).toBe(1200)
  expect(context.fillStyle).toBe('#fff')
  expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1600, 1200)
  expect(context.drawImage).toHaveBeenCalledWith(image, 0, 0, 1600, 1200)
  expect(canvas.toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'image/jpeg', 0.8)
  expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' })
  expect(image.close).toHaveBeenCalledOnce()
  const small = canvasFixture(200, 300)
  await resizePhoto(file)
  expect(small.canvas.width).toBe(200)
  expect(small.canvas.height).toBe(300)
})

it.each(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', ''])('lets native decoding handle camera MIME %j with EXIF orientation', async type => {
  const fixture = canvasFixture(2400, 3200)
  const cameraFile = new File(['camera fixture'], 'capture', { type })
  expect(await resizePhoto(cameraFile)).toBe(fixture.encoded)
  expect(createImageBitmap).toHaveBeenCalledExactlyOnceWith(cameraFile, { imageOrientation: 'from-image' })
  expect([fixture.canvas.width, fixture.canvas.height]).toEqual([1200, 1600])
})

it.each([2, 3])('steps JPEG quality down only while over the byte target (pass %i)', async passes => {
  const { canvas, encoded, image } = canvasFixture()
  const oversized = new Blob([new Uint8Array(MAX_RESIZED_PHOTO_BYTES + 1)], { type: 'image/jpeg' })
  let attempt = 0
  canvas.toBlob.mockImplementation(callback => callback(++attempt < passes ? oversized : encoded))
  expect(await resizePhoto(file)).toBe(encoded)
  expect(canvas.toBlob.mock.calls.map(call => call[2])).toEqual([0.8, 0.7, 0.6].slice(0, passes))
  expect(image.close).toHaveBeenCalledOnce()
})

it('accepts the exact byte target and gives a useful error after the final oversized JPEG pass', async () => {
  const { canvas, image } = canvasFixture()
  const limit = new Blob([new Uint8Array(MAX_RESIZED_PHOTO_BYTES)], { type: 'image/jpeg' })
  canvas.toBlob.mockImplementation(callback => callback(limit))
  expect(await resizePhoto(file)).toBe(limit)
  expect(canvas.toBlob).toHaveBeenCalledOnce()
  canvas.toBlob.mockClear().mockImplementation(callback => callback(new Blob([limit, 'x'], { type: 'image/jpeg' })))
  image.close.mockClear()
  await expect(resizePhoto(file)).rejects.toThrow(PHOTO_TOO_LARGE_ERROR)
  expect(canvas.toBlob.mock.calls.map(call => call[2])).toEqual([0.8, 0.7, 0.6])
  expect(image.close).toHaveBeenCalledOnce()
})

it('shows a useful read-image error for decode, missing canvas, draw and toBlob failures, releasing decoded images', async () => {
  for (const failure of ['decode', 'context', 'draw', 'null_blob', 'throw_blob', 'empty']) {
    const { image, canvas, context } = canvasFixture()
    if (failure === 'decode') vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('decode failed') }))
    if (failure === 'context') canvas.getContext.mockReturnValue(null)
    if (failure === 'draw') context.drawImage.mockImplementation(() => { throw new Error('draw failed') })
    if (failure === 'null_blob') canvas.toBlob.mockImplementation(callback => callback(null))
    if (failure === 'throw_blob') canvas.toBlob.mockImplementation(() => { throw new Error('encoding failed') })
    if (failure === 'empty') image.width = 0
    await expect(resizePhoto(file)).rejects.toThrow(PHOTO_READ_ERROR)
    expect(image.close).toHaveBeenCalledTimes(failure === 'decode' ? 0 : 1)
  }
  const decoder = vi.mocked(createImageBitmap)
  decoder.mockClear()
  await expect(resizePhoto(new File(['pdf'], 'bad.pdf', { type: 'application/pdf' }))).rejects.toThrow(PHOTO_READ_ERROR)
  expect(decoder).not.toHaveBeenCalled()
})

it('uploads raw JPEG with same-origin cookies and no bearer, JSON encoding or storage URL', async () => {
  const photo = new Blob(['JPEG'], { type: 'image/jpeg' })
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ photo_version: 'version' }))
  expect(await uploadPhoto('cache', 'item', photo)).toEqual({ photo_version: 'version' })
  expect(fetchMock).toHaveBeenCalledWith('/api/caches/cache/items/item/photo', {
    method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'image/jpeg' }, body: photo,
  })
})

it('shows the same clear shared-upload budget error for item and profile photos', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ error: 'rate_limited', limit: 'photo_upload' }, { status: 429, headers: { 'Retry-After': '3600' } }))
  for (const upload of [() => uploadPhoto('cache', 'item', new Blob()), () => uploadProfilePhoto(new Blob())]) {
    let failure: unknown
    try { await upload() } catch (error) { failure = error }
    expect(failure).toMatchObject({ status: 429, code: 'rate_limited', limit: 'photo_upload' })
    expect(errorMessage(failure)).toBe('Too many photo uploads, try again later.')
  }
})

it('surfaces photo type, size and lost-authorization errors from the API', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  for (const [status, error] of [[415, 'invalid_photo_type'], [413, 'photo_too_large'], [404, 'not_found']] as const) {
    fetchMock.mockResolvedValueOnce(Response.json({ error }, { status }))
    await expect(uploadPhoto('cache', 'item', new Blob())).rejects.toMatchObject({ status, code: error })
  }
  expect(errorMessage(new ApiError(415, 'invalid_photo_type'))).toContain('JPEG, PNG or WebP')
  expect(errorMessage(new ApiError(413, 'photo_too_large'))).toContain('5 MB')
})
