import { ApiError } from './api'
import type { Item } from './items'

export const PHOTO_READ_ERROR = "Couldn't read that image, try another."

export async function resizePhoto(file: File): Promise<Blob> {
  try {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('unsupported')
    const image = await createImageBitmap(file)
    try {
      if (!image.width || !image.height) throw new Error('empty image')
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas unavailable')
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('encoding failed')), 'image/jpeg', 0.85)
      })
    } finally { image.close() }
  } catch { throw new Error(PHOTO_READ_ERROR) }
}

export async function uploadPhoto(cacheId: string | null, itemId: string, photo: Blob): Promise<Item> {
  const response = await fetch(`${cacheId ? `/api/caches/${cacheId}/items` : '/api/me/items'}/${itemId}/photo`, {
    method: 'POST', credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': photo.type }, body: photo,
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string }
    throw new ApiError(response.status, data.error ?? 'request_failed')
  }
  return response.json() as Promise<Item>
}
