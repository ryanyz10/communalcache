import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../lib/api'
import type { Item } from '../lib/items'
import { PHOTO_READ_ERROR, resizePhoto, uploadPhoto } from '../lib/photos'

export function ItemPhoto({ item, thumbnail = false }: { item: Item; thumbnail?: boolean }) {
  const [failed, setFailed] = useState(false)
  if (!item.photo_version) return null
  if (failed) return <p className="mt-3 text-sm text-slate-600">Photo unavailable. Refresh to try again.</p>
  return <img src={`/api/caches/${item.cache_id}/items/${item.id}/photo?v=${encodeURIComponent(item.photo_version)}`} alt={`Photo of ${item.title}`} loading={thumbnail ? 'lazy' : 'eager'} onError={() => setFailed(true)} className={`mt-3 w-full rounded-lg object-contain ${thumbnail ? 'h-40' : 'max-h-80'}`} />
}

export function PhotoUpload({ item }: { item: Item }) {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const save = useMutation({
    mutationFn: async () => uploadPhoto(item.cache_id, item.id, await resizePhoto(file!)),
    onSuccess: async saved => {
      queryClient.setQueryData(['item', item.cache_id, item.id], saved)
      await queryClient.invalidateQueries({ queryKey: ['items', item.cache_id] })
      setFile(null)
      if (input.current) input.current.value = ''
    },
  })
  function onSubmit(event: FormEvent) { event.preventDefault(); if (file) save.mutate() }
  return <section className="mt-8" aria-labelledby="photo-heading">
    <h2 id="photo-heading" className="text-xl font-semibold">{item.photo_version ? 'Replace photo' : 'Add a photo'}</h2>
    <form className="mt-4 space-y-3" onSubmit={onSubmit}>
      <label htmlFor="item-photo" className="block text-sm font-medium">Choose a photo (JPEG, PNG or WebP)</label>
      <input ref={input} id="item-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={save.isPending} onChange={event => { setFile(event.target.files?.[0] ?? null); save.reset() }} className="block w-full rounded-md border border-slate-300 bg-white p-2" />
      <p className="text-sm text-slate-600">Resized to at most 1600 pixels and saved as JPEG. Only cache members can see it.</p>
      {save.isError && <p role="alert" className="text-red-700">{save.error instanceof Error && save.error.message === PHOTO_READ_ERROR ? PHOTO_READ_ERROR : errorMessage(save.error)}</p>}
      {save.isSuccess && <p role="status" className="text-emerald-700">Photo saved.</p>}
      <button type="submit" disabled={!file || save.isPending} className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60">{save.isPending ? 'Saving photo…' : 'Upload photo'}</button>
    </form>
  </section>
}
