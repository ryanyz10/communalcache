import { useState } from 'react'
import type { Item } from '../lib/items'
import { ThingNameArt, thingTone } from '../components/ThingTile'

export function ItemPhoto({ item }: { item: Item }) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const showPhoto = item.photo_version && !photoFailed
  const photoBase = item.cache_id ? `/api/caches/${item.cache_id}/items` : '/api/me/items'

  return <div className={`cc-item-photo-frame cc-thing-tile cc-thing-tile-${thingTone(item.id)}`}>
    {showPhoto ? <img
      src={`${photoBase}/${item.id}/photo?v=${encodeURIComponent(item.photo_version!)}`}
      alt={`Photo of ${item.title}`}
      onError={() => setPhotoFailed(true)}
    /> : <>
      <ThingNameArt title={item.title} />
      {!photoFailed && <span className="cc-item-photo-hint">no photo yet · tile shows the name</span>}
      {photoFailed && <div className="cc-item-photo-error">
        <p role="status">Photo unavailable.</p>
        <button type="button" onClick={() => setPhotoFailed(false)}>Try photo again</button>
      </div>}
    </>}
  </div>
}
