import { useState } from 'react'
import { initials, profilePhotoSrc } from '../lib/avatars'
import { artHash, AVATAR_COLORS } from '../lib/pixelArt'

export function Avatar({ userId, name, photoVersion, size = 32 }: { userId: string; name: string; photoVersion?: string | null; size?: number }) {
  const source = profilePhotoSrc(userId,photoVersion)
  const [failed, setFailed] = useState<string | null>(null)
  return <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-900 font-semibold text-white" style={{width:size,height:size,fontSize:Math.round(size*0.42),background:AVATAR_COLORS[artHash(userId || name)%AVATAR_COLORS.length],color:'#fff'}}>
    {source && failed !== source ? <img key={source} src={source} alt="" loading="lazy" onError={()=>setFailed(source)} className="h-full w-full object-cover" /> : initials(name)}
  </span>
}
