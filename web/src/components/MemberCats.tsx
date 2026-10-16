import type { CacheMember } from '../lib/caches'
import { Cat } from './Cat'

export function MemberCats({ members, total = members.length, limit = 3 }: { members: CacheMember[]; total?: number; limit?: number }) {
  return <span className="cc-member-cats" aria-hidden="true">
    {members.slice(0,limit).map((member,index)=><span key={member.user_id} className={index % 3 === 0 ? 'cc-roof-loaf' : 'cc-roof-sit'}><Cat userId={member.user_id} coat={member.cat_coat} pose={index % 3 === 0 ? 'loaf' : 'sit'} /></span>)}
    {total > limit && <span className="cc-roof-overflow">+{total-limit}</span>}
  </span>
}
