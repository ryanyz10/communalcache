import { afterEach, expect, it, vi } from 'vitest'
import { PHOTO_READ_ERROR, resizePhoto, uploadPhoto, uploadProfilePhoto } from './photos'
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
  expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85)
  expect(image.close).toHaveBeenCalledOnce()
  const small = canvasFixture(200, 300)
  await resizePhoto(file)
  expect(small.canvas.width).toBe(200)
  expect(small.canvas.height).toBe(300)
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
  await expect(resizePhoto(new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' }))).rejects.toThrow(PHOTO_READ_ERROR)
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
