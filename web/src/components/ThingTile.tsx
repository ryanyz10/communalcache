import { useState } from 'react'
import type { Item } from '../lib/items'
import { catHash } from '../lib/cats'

export function thingTone(id: string) {
  return (['clay', 'sage', 'sand'] as const)[catHash(id) % 3]
}

export function ThingNameArt({ title }: { title: string }) {
  return <span className="cc-thing-name" aria-hidden="true">{title.toLocaleLowerCase().replace(/^\d+[-\s]\S+\s+/, '')}</span>
}

export function ThingTile({ item, library = false, tone = 'pale' }: { item: Item; library?: boolean; tone?: 'pale' | 'deep' }) {
  const [failed, setFailed] = useState(false)
  return <span className={`cc-thing-tile cc-thing-tile-${thingTone(item.id)} cc-thing-tile-${tone}`} aria-hidden="true">
    {item.photo_version && !failed
      ? <img alt="" src={`${library ? `/api/me/items/${item.id}` : `/api/caches/${item.cache_id}/items/${item.id}`}/photo?v=${encodeURIComponent(item.photo_version)}`} onError={() => setFailed(true)} />
      : <ThingNameArt title={item.title} />}
  </span>
}

export function ThingStatus({ item, pending = 0, compact = false, quantityAsStatus = true }: {
  item: Item
  pending?: number
  compact?: boolean
  quantityAsStatus?: boolean
}) {
  let status: string
  let tone: string
  if (item.active === false) {
    status = 'Inactive'
    tone = 'muted'
  } else if (pending) {
    status = `${pending} ${pending === 1 ? 'ask' : 'asks'}${compact ? '' : ' waiting'}`
    tone = 'pending'
  } else if (item.available === false) {
    status = 'Lent out'
    tone = 'muted'
  } else if (item.is_consumable && quantityAsStatus) {
    status = `Give · ${item.available_quantity ?? item.quantity ?? 0}`
    tone = 'give'
  } else if (item.is_consumable && (item.available_quantity ?? item.quantity ?? 0) <= 0) {
    status = 'No stock'
    tone = 'muted'
  } else {
    status = 'Available'
    tone = 'available'
  }
  return <span className={`cc-thing-status cc-thing-status-${tone}`}>
    <span aria-hidden="true" />{status}
  </span>
}
