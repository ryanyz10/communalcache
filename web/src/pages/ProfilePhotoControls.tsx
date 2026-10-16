import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { Avatar } from '../components/Avatar'
import { apiFetch, errorMessage } from '../lib/api'
import { PHOTO_READ_ERROR, resizePhoto, uploadProfilePhoto } from '../lib/photos'
import { invalidateRequestViews } from '../lib/requests'

export function ProfilePhotoControls() {
  const { me } = useAuth()
  const client = useQueryClient(), dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const change = useMutation({
    mutationFn: async (action: 'upload'|'remove') => action === 'remove'
      ? apiFetch<void>('/api/me/photo',{method:'DELETE'}) : uploadProfilePhoto(await resizePhoto(file!)),
    onSuccess: async () => {
      // Refetch identity instead of restoring an upload response after an account change.
      await Promise.all([
        client.invalidateQueries({queryKey:['me']}),client.invalidateQueries({queryKey:['cache']}),
        client.invalidateQueries({queryKey:['join-requests']}),invalidateRequestViews(client),
      ])
      setFile(null)
      if (input.current) input.current.value = ''
      dialog.current?.close()
    },
  })
  if (!me) return null
  function submit(event: FormEvent) { event.preventDefault(); if (file) change.mutate('upload') }
  return <>
    <div className="cc-row">
      <Avatar userId={me.id} name={me.display_name ?? 'You'} photoVersion={me.profile_photo_version} size={48} />
      <div className="min-w-0 flex-1"><p className="font-semibold">Profile photo</p><p className="text-sm text-slate-600">{me.profile_photo_version ? 'Shared privately with people in your active caches.' : 'Your cat shows until you add a photo.'}</p></div>
      <button type="button" className="min-h-11 shrink-0 text-sm underline" aria-haspopup="dialog" aria-controls="profile-photo-sheet" onClick={()=>{change.reset();dialog.current?.showModal()}}>Change photo</button>
    </div>
    <dialog ref={dialog} id="profile-photo-sheet" className="cc-sheet lg:w-[440px] lg:rounded-2xl lg:p-6" aria-labelledby="profile-photo-heading" onCancel={event=>{if(change.isPending)event.preventDefault()}} onClose={()=>{setFile(null);if(input.current)input.current.value=''}}>
      <div className="flex items-center justify-between gap-3"><h2 id="profile-photo-heading" className="text-xl font-semibold">Profile photo</h2><button type="button" autoFocus disabled={change.isPending} className="cc-outline min-h-11" onClick={()=>dialog.current?.close()}>Close</button></div>
      <div className="my-5 flex justify-center"><Avatar userId={me.id} name={me.display_name ?? 'You'} photoVersion={me.profile_photo_version} size={110} /></div>
      <p className="text-sm text-slate-600">Only you and people who share an active cache with you can see it. Your cat when there is none.</p>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <label htmlFor="profile-photo-file" className="block text-sm font-medium">Choose a photo</label>
        <input ref={input} id="profile-photo-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={change.isPending} onChange={event=>{setFile(event.target.files?.[0] ?? null);change.reset()}} className="block w-full rounded-md border border-slate-300 p-2" />
        <p className="text-sm text-slate-600">JPEG, PNG or WebP. Resized to at most 1600 pixels; maximum 5 MB after resizing.</p>
        <button type="submit" disabled={!file || change.isPending} className="cc-pill min-h-11">{change.isPending ? 'Saving…' : 'Save photo'}</button>
      </form>
      <button type="button" disabled={!me.profile_photo_version || change.isPending} onClick={()=>change.mutate('remove')} className="cc-outline mt-3 min-h-11 text-red-800">Remove photo</button>
      {change.isError && <p role="alert" className="mt-3 text-red-700">{change.error instanceof Error && change.error.message===PHOTO_READ_ERROR ? PHOTO_READ_ERROR : errorMessage(change.error)}</p>}
    </dialog>
  </>
}
