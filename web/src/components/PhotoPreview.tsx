import type { ReactNode } from 'react'
import '../photos.css'

export function PhotoPreview({ src, alt, children }: { src: string | null; alt: string; children?: ReactNode }) {
  return <div className="cc-photo-preview">
    {src ? <img src={src} alt={alt} /> : children ?? <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>}
  </div>
}
