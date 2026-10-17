import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../lib/api'
import type { Item } from '../lib/items'
import { PHOTO_READ_ERROR, resizePhoto, uploadPhoto } from '../lib/photos'
import { invalidateRequestViews } from '../lib/requests'
import { thingTone } from '../components/ThingTile'

export function ItemPhoto({ item }: { item: Item }) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const showPhoto = item.photo_version && !photoFailed
  const photoBase = item.cache_id ? `/api/caches/${item.cache_id}/items` : '/api/me/items'

  return <div className={`cc-item-photo-frame cc-thing-tile-${thingTone(item.id)}`}>
    {showPhoto ? <img
      src={`${photoBase}/${item.id}/photo?v=${encodeURIComponent(item.photo_version!)}`}
      alt={`Photo of ${item.title}`}
      onError={() => setPhotoFailed(true)}
    /> : <>
      <span className="cc-item-name-art" aria-hidden="true">{item.title.toLocaleLowerCase()}</span>
      {!photoFailed && <span className="cc-item-photo-hint">no photo yet · tile shows the name</span>}
      {photoFailed && <div className="cc-item-photo-error">
        <p role="status">Photo unavailable.</p>
        <button type="button" onClick={() => setPhotoFailed(false)}>Try photo again</button>
      </div>}
    </>}
  </div>
}

export function PhotoUpload({ item }: { item: Item }) {
  const queryClient = useQueryClient()
  const photoInput = useRef<HTMLInputElement>(null)
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null)
  const savePhoto = useMutation({
    mutationFn: async () => uploadPhoto(item.cache_id, item.id, await resizePhoto(selectedPhoto!)),
    onSuccess: async saved => {
      if (item.cache_id) queryClient.setQueryData(['item', item.cache_id, item.id], saved)
      await invalidateRequestViews(queryClient)
      setSelectedPhoto(null)
      if (photoInput.current) photoInput.current.value = ''
    },
  })
  const photoError = savePhoto.error instanceof Error && savePhoto.error.message === PHOTO_READ_ERROR
    ? PHOTO_READ_ERROR : errorMessage(savePhoto.error)

  function submitPhoto(event: FormEvent) {
    event.preventDefault()
    if (selectedPhoto) savePhoto.mutate()
  }

  return <section className="cc-owner-photo" aria-labelledby="photo-heading">
    <h2 id="photo-heading">{item.photo_version ? 'Replace photo' : 'Add a photo'}</h2>
    <form onSubmit={submitPhoto}>
      <label htmlFor="item-photo">Choose a photo (JPEG, PNG or WebP)</label>
      <input
        ref={photoInput}
        id="item-photo"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={savePhoto.isPending}
        onChange={event => {
          setSelectedPhoto(event.target.files?.[0] ?? null)
          savePhoto.reset()
        }}
      />
      <p className="cc-form-hint">Resized to at most 1600 pixels and saved as JPEG. Private to you and members of caches where you share it.</p>
      {savePhoto.isError && <p role="alert" className="cc-form-error">{photoError}</p>}
      {savePhoto.isSuccess && <p role="status">Photo saved.</p>}
      <button type="submit" disabled={!selectedPhoto || savePhoto.isPending} className="cc-profile-secondary">
        {savePhoto.isPending ? 'Saving photo…' : 'Upload photo'}
      </button>
    </form>
  </section>
}
