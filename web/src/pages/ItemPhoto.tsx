import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../lib/api'
import type { Item } from '../lib/items'
import { uploadPhoto } from '../lib/photos'
import { usePhotoSelection } from '../lib/usePhotoSelection'
import { PhotoPreview } from '../components/PhotoPreview'
import { invalidateRequestViews } from '../lib/requests'
import { thingTone } from '../components/ThingTile'
import { useToast } from '../components/Toast'
import { transientActionFailure } from '../lib/feedback'

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
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const photoInput = useRef<HTMLInputElement>(null)
  const photo = usePhotoSelection()
  const savePhoto = useMutation({
    mutationFn: async () => uploadPhoto(item.cache_id, item.id, photo.photo!),
    onSuccess: async saved => {
      if (item.cache_id) queryClient.setQueryData(['item', item.cache_id, item.id], saved)
      await invalidateRequestViews(queryClient)
      photo.clear()
      if (photoInput.current) photoInput.current.value = ''
      showToast('Photo saved.')
    },
    onError: error => { if (transientActionFailure(error)) showToast(errorMessage(error), 'error') },
  })
  const photoError = errorMessage(savePhoto.error)

  function submitPhoto(event: FormEvent) {
    event.preventDefault()
    if (photo.photo && !photo.processing) savePhoto.mutate()
  }

  return <section className="cc-owner-photo" aria-labelledby="photo-heading">
    <h2 id="photo-heading">{item.photo_version ? 'Replace photo' : 'Add a photo'}</h2>
    <form onSubmit={submitPhoto}>
      <label htmlFor="item-photo" className="cc-photo-picker">
        <PhotoPreview src={photo.preview} alt="Selected replacement item photo preview" />
        <strong>{photo.preview ? 'Replace selected photo' : 'Choose a photo'}</strong>
        <span>Camera or library</span>
        <input
          ref={photoInput}
          id="item-photo"
          type="file"
          accept="image/*"
          disabled={savePhoto.isPending}
          onChange={event => {
            void photo.select(event.target.files?.[0] ?? null)
            savePhoto.reset()
          }}
        />
      </label>
      {(photo.photo || photo.processing || photo.error) && <button type="button" disabled={savePhoto.isPending} className="cc-profile-secondary" onClick={() => {
        photo.clear()
        savePhoto.reset()
        if (photoInput.current) photoInput.current.value = ''
      }}>Remove selected photo</button>}
      {photo.processing && <p role="status">Preparing photo…</p>}
      {photo.error && <p role="alert" className="cc-form-error">{photo.error}</p>}
      <p className="cc-form-hint">Resized to at most 1600 pixels and saved as JPEG. Private to you and members of caches where you share it.</p>
      {savePhoto.isError && !transientActionFailure(savePhoto.error) && <p role="alert" className="cc-form-error">{photoError}</p>}
      <button type="submit" disabled={!photo.photo || photo.processing || savePhoto.isPending} className="cc-profile-secondary">
        {savePhoto.isPending ? 'Saving photo…' : 'Upload photo'}
      </button>
    </form>
  </section>
}
