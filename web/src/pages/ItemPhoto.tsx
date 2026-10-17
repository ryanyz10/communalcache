import { useRef,useState,type FormEvent } from 'react'
import { useMutation,useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../lib/api'
import type { Item } from '../lib/items'
import { PHOTO_READ_ERROR,resizePhoto,uploadPhoto } from '../lib/photos'
import { invalidateRequestViews } from '../lib/requests'
import { thingTone } from '../components/ThingTile'

export function ItemPhoto({item}:{item:Item}) {
  const [failed,setFailed]=useState(false)
  return <div className={`cc-item-photo-frame cc-thing-tile-${thingTone(item.id)}`}>
    {item.photo_version && !failed ? <img src={`${item.cache_id?`/api/caches/${item.cache_id}/items`:'/api/me/items'}/${item.id}/photo?v=${encodeURIComponent(item.photo_version)}`} alt={`Photo of ${item.title}`} onError={()=>setFailed(true)} /> : <>
      <span className="cc-item-name-art" aria-hidden="true">{item.title.toLocaleLowerCase()}</span>
      {!failed && <span className="cc-item-photo-hint">no photo yet · tile shows the name</span>}
      {failed && <div className="cc-item-photo-error"><p role="status">Photo unavailable.</p><button type="button" onClick={()=>setFailed(false)}>Try photo again</button></div>}
    </>}
  </div>
}

export function PhotoUpload({item}:{item:Item}) {
  const queryClient=useQueryClient(),input=useRef<HTMLInputElement>(null)
  const [file,setFile]=useState<File|null>(null)
  const save=useMutation({
    mutationFn:async()=>uploadPhoto(item.cache_id,item.id,await resizePhoto(file!)),
    onSuccess:async saved=>{
      if(item.cache_id) queryClient.setQueryData(['item',item.cache_id,item.id],saved)
      await invalidateRequestViews(queryClient)
      setFile(null)
      if(input.current) input.current.value=''
    },
  })
  function onSubmit(event:FormEvent) {event.preventDefault();if(file) save.mutate()}
  return <section className="cc-owner-photo" aria-labelledby="photo-heading"><h2 id="photo-heading">{item.photo_version?'Replace photo':'Add a photo'}</h2><form onSubmit={onSubmit}>
    <label htmlFor="item-photo">Choose a photo (JPEG, PNG or WebP)</label><input ref={input} id="item-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={save.isPending} onChange={event=>{setFile(event.target.files?.[0] ?? null);save.reset()}} />
    <p className="cc-form-hint">Resized to at most 1600 pixels and saved as JPEG. Private to you and members of caches where you share it.</p>
    {save.isError && <p role="alert" className="cc-form-error">{save.error instanceof Error && save.error.message===PHOTO_READ_ERROR?PHOTO_READ_ERROR:errorMessage(save.error)}</p>}
    {save.isSuccess && <p role="status">Photo saved.</p>}
    <button type="submit" disabled={!file || save.isPending} className="cc-profile-secondary">{save.isPending?'Saving photo…':'Upload photo'}</button>
  </form></section>
}
