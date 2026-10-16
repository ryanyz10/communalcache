import { Cat } from './Cat'
import { Stamp } from './Stamp'
import type { CatCoat } from '../lib/cats'
import type { InvitePreview } from '../lib/joining'
import { Shimmer } from './Skeleton'

export function InviteBox({ name, userId, coat, preview, pending = false, loading = false }: { name?: string; userId: string; coat?: CatCoat | null; preview?: InvitePreview; pending?: boolean; loading?: boolean }) {
  return <div className={`cc-invite-scene${pending ? ' cc-invite-scene-pending' : ''}`}>
    {!pending && <>
      {preview && <div className="cc-invite-members" aria-hidden="true">{preview.members.map((traits,index)=><span key={index} className={index===0 || index===3?'cc-invite-cat-loaf':'cc-invite-cat-sit'}><Cat traits={traits} pose={index===0 || index===3?'loaf':'sit'} /></span>)}{preview.active_member_count>preview.members.length && <span className="cc-invite-overflow">+{preview.active_member_count-preview.members.length}</span>}</div>}
      <span className="cc-invite-you" aria-hidden="true">YOU</span>
    </>}
    <div className="cc-invite-box">
      <span className="cc-invite-handle" aria-hidden="true" />
      {pending && <span className="cc-invite-stamp"><Stamp tone="warn">REQUEST SAVED</Stamp></span>}
      <span className="cc-invite-label">{loading ? <Shimmer width={220} height={34} /> : preview?.name ?? name ?? 'Your invitation'}</span>
      {loading && <Shimmer width={110} height={12} />}
      {preview && <span className="cc-invite-count">{preview.active_member_count} {preview.active_member_count===1?'neighbor':'neighbors'}</span>}
    </div>
    {pending && <span className="cc-invite-waiting-cat" aria-hidden="true"><Cat userId={userId} coat={coat} /></span>}
  </div>
}
