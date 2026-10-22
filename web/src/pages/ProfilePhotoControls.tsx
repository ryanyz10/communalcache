import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { Avatar } from '../components/Avatar'
import { apiFetch, errorMessage } from '../lib/api'
import { uploadProfilePhoto } from '../lib/photos'
import { usePhotoSelection } from '../lib/usePhotoSelection'
import { PhotoPreview } from '../components/PhotoPreview'
import { refreshProfileViews } from '../lib/profile'
import { catTraits, COATS } from '../lib/cats'
import { CoatControls } from '../components/CoatControls'
import { useToast } from '../components/Toast'
import { transientActionFailure } from '../lib/feedback'

export function ProfilePhotoControls() {
  const { me } = useAuth()
  const client = useQueryClient()
  const { showToast } = useToast()
  const photoDialog = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const photo = usePhotoSelection()
  const [coatBusy, setCoatBusy] = useState(false)
  const changePhoto = useMutation({
    mutationFn: async (action: 'upload' | 'remove') => {
      if (action === 'remove') return apiFetch<void>('/api/me/photo', { method: 'DELETE' })
      return uploadProfilePhoto(photo.photo!)
    },
    onSuccess: async (_data, action) => {
      // Refetch identity instead of restoring an upload response after an account change.
      await refreshProfileViews(client)
      photo.clear()
      if (fileInput.current) fileInput.current.value = ''
      photoDialog.current?.close()
      showToast(action === 'remove' ? 'Photo removed.' : 'Photo saved.')
    },
    onError: error => { if (transientActionFailure(error)) showToast(errorMessage(error), 'error') },
  })
  if (!me) return null

  const coatName = COATS.find(coat => coat.key === catTraits(me.id, me.cat_coat).coat)!.name
  function submit(event: FormEvent) {
    event.preventDefault()
    if (photo.photo && !photo.processing) changePhoto.mutate('upload')
  }

  return <>
    <div className="cc-profile-photo-row">
      <Avatar userId={me.id} name={me.display_name ?? 'You'} photoVersion={me.profile_photo_version} coat={me.cat_coat} size={64} />
      <div className="cc-profile-photo-copy">
        <strong className="cc-profile-photo-title-desktop">Profile photo</strong>
        <strong className="cc-profile-photo-title-mobile">{me.profile_photo_version ? 'Profile photo' : `${coatName} cat`}</strong>
        <p className="cc-profile-photo-hint-desktop">Your cat shows until you add a photo.</p>
        <p className="cc-profile-photo-hint-mobile">Change cat or add a photo</p>
      </div>
      <button type="button" className="cc-profile-photo-trigger cc-profile-secondary" aria-label="Change photo" aria-haspopup="dialog" aria-controls="profile-photo-sheet" onClick={() => {
        changePhoto.reset()
        photoDialog.current?.showModal()
      }}>
        <span className="cc-profile-photo-title-desktop">{me.profile_photo_version ? 'Change photo' : 'Upload photo'}</span>
        <span className="cc-profile-photo-title-mobile" aria-hidden="true">›</span>
      </button>
    </div>
    <dialog
      ref={photoDialog} id="profile-photo-sheet" className="cc-sheet lg:w-[440px] lg:rounded-2xl lg:p-6" aria-labelledby="profile-photo-heading"
      onCancel={event => { if (changePhoto.isPending || coatBusy) event.preventDefault() }}
      onClose={() => { photo.clear(); if (fileInput.current) fileInput.current.value = '' }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="profile-photo-heading" className="text-xl font-semibold">Profile photo</h2>
        <button type="button" autoFocus disabled={changePhoto.isPending || coatBusy} className="cc-outline min-h-11" onClick={() => photoDialog.current?.close()}>Close</button>
      </div>

      <p className="text-sm text-slate-600">Only you and people who share an active cache with you can see it. Your cat when there is none.</p>
      <CoatControls className="cc-photo-coat-mobile" resettable disabled={changePhoto.isPending} onBusy={setCoatBusy} />
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <label htmlFor="profile-photo-file" className="cc-photo-picker">
          <PhotoPreview src={photo.preview} alt="Selected profile photo preview">
            <Avatar userId={me.id} name={me.display_name ?? 'You'} photoVersion={me.profile_photo_version} coat={me.cat_coat} size={110} />
          </PhotoPreview>
          <strong>{photo.preview ? 'Replace selected photo' : 'Choose a photo'}</strong>
          <span>Camera or library</span>
          <input
            ref={fileInput} id="profile-photo-file" type="file" accept="image/*" disabled={changePhoto.isPending}
            onChange={event => { void photo.select(event.target.files?.[0] ?? null); changePhoto.reset() }}
          />
        </label>
        {(photo.photo || photo.processing || photo.error) && <button type="button" disabled={changePhoto.isPending} className="cc-profile-secondary" onClick={() => {
          photo.clear()
          changePhoto.reset()
          if (fileInput.current) fileInput.current.value = ''
        }}>Remove selected photo</button>}
        {photo.processing && <p role="status">Preparing photo…</p>}
        {photo.error && <p role="alert" className="cc-form-error">{photo.error}</p>}
        <p className="text-sm text-slate-600">Resized to at most 1600 pixels and saved as JPEG, targeting 1.5 MB or less.</p>
        <button type="submit" disabled={!photo.photo || photo.processing || changePhoto.isPending} className="cc-pill min-h-11">{changePhoto.isPending ? 'Saving…' : 'Save photo'}</button>
      </form>
      <button type="button" disabled={!me.profile_photo_version || changePhoto.isPending} onClick={() => changePhoto.mutate('remove')} className="cc-outline mt-3 min-h-11 text-red-800">Remove photo</button>
      {changePhoto.isError && !transientActionFailure(changePhoto.error) && <p role="alert" className="mt-3 text-red-700">
        {errorMessage(changePhoto.error)}
      </p>}
    </dialog>
  </>
}
