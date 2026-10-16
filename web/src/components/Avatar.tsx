import { useState } from 'react'
import { profilePhotoSrc } from '../lib/avatars'
import { Cat } from './Cat'
import type { CatCoat } from '../lib/cats'

export function Avatar({ userId, name, coat, photoVersion, size = 32 }: { userId: string; name: string; coat?: CatCoat | null; photoVersion?: string | null; size?: number }) {
  const source = profilePhotoSrc(userId, photoVersion)
  const [failed, setFailed] = useState<string | null>(null)
  return <span aria-hidden="true" className="cc-avatar" style={{ width: size, height: size }}>
    {source && failed !== source ? <img key={source} src={source} alt="" loading="lazy" onError={() => setFailed(source)} />
      : <span className="cc-avatar-cat" style={{ width: Math.round(size * 1.13), marginBottom: Math.round(size * .21) }}><Cat key={`${userId}:${coat ?? ''}`} userId={userId} coat={coat} pose="peek" /></span>}
    <span className="sr-only">{name}</span>
  </span>
}
