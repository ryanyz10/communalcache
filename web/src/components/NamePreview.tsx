import { Cat } from './Cat'
import type { CatCoat } from '../lib/cats'

export function NamePreview({ name, userId, coat }: { name: string; userId: string; coat?: CatCoat | null }) {
  return <div className="cc-name-preview" aria-live="polite" aria-atomic="true">
    <span aria-hidden="true" className="cc-name-cat"><Cat userId={userId} coat={coat} /></span>
    <div className="cc-name-box"><div className="cc-name-tag"><span>HELLO, MY NAME IS</span><strong>{name.trim() || 'Your name'}</strong></div></div>
  </div>
}
