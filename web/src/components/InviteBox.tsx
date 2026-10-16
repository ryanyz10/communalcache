import { Cat } from './Cat'
import { Stamp } from './Stamp'
import type { CatCoat } from '../lib/cats'

export function InviteBox({ name, userId, coat, pending = false }: { name?: string; userId: string; coat?: CatCoat | null; pending?: boolean }) {
  return <div className={`cc-invite-scene${pending ? ' cc-invite-scene-pending' : ''}`}>
    {!pending && <span className="cc-invite-you" aria-hidden="true">YOU</span>}
    <div className="cc-invite-box">
      <span className="cc-invite-handle" aria-hidden="true" />
      {pending && <span className="cc-invite-stamp"><Stamp tone="warn">REQUEST SAVED</Stamp></span>}
      <span className="cc-invite-label">{name ?? 'Your invitation'}</span>
    </div>
    {pending && <span className="cc-invite-waiting-cat" aria-hidden="true"><Cat userId={userId} coat={coat} /></span>}
  </div>
}
