import { ApiError, type Me } from './api'
import type { Item } from './items'

export const PHOTO_READ_ERROR = "Couldn't read that image, try another."
export const PHOTO_TOO_LARGE_ERROR = 'That photo is still too large. Try another image.'
export const MAX_RESIZED_PHOTO_BYTES = 1.5 * 1024 * 1024

export async function resizePhoto(file: File): Promise<Blob> {
  try {
    if (file.type && !file.type.startsWith('image/')) throw new Error('unsupported')
    const image = await createImageBitmap(file, { imageOrientation: 'from-image' })
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
      for (const quality of [0.8, 0.7, 0.6]) {
        const photo = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('encoding failed')), 'image/jpeg', quality)
        })
        if (photo.size <= MAX_RESIZED_PHOTO_BYTES) return photo
      }
      throw new Error(PHOTO_TOO_LARGE_ERROR)
    } finally { image.close() }
  } catch (error) {
    throw new Error(error instanceof Error && error.message === PHOTO_TOO_LARGE_ERROR ? PHOTO_TOO_LARGE_ERROR : PHOTO_READ_ERROR)
  }
}

export function uploadPhoto(cacheId: string | null, itemId: string, photo: Blob) {
  return uploadImage<Item>(`${cacheId ? `/api/caches/${cacheId}/items` : '/api/me/items'}/${itemId}/photo`,photo)
}

export function uploadProfilePhoto(photo: Blob) { return uploadImage<Me>('/api/me/photo',photo) }

async function uploadImage<T>(path: string, photo: Blob): Promise<T> {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': photo.type }, body: photo,
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string; limit?: string }
    throw new ApiError(response.status,data.error ?? 'request_failed',undefined,typeof data.limit === 'string' ? data.limit : undefined)
  }
  return response.json() as Promise<T>
}
