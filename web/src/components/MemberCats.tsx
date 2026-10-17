import type { CacheMember } from '../lib/caches'
import { Cat } from './Cat'

export function MemberCats({ members, total = members.length, limit = 3 }: { members: CacheMember[]; total?: number; limit?: number }) {
  return <span className="cc-member-cats" aria-hidden="true">
    {members.slice(0, limit).map((member, index) => {
      const loaf = index % 3 === 0
      return <span key={member.user_id} className={loaf ? 'cc-roof-loaf' : 'cc-roof-sit'}>
        <Cat userId={member.user_id} coat={member.cat_coat} pose={loaf ? 'loaf' : 'sit'} />
      </span>
    })}
    {total > limit && <span className="cc-roof-overflow">+{total - limit}</span>}
  </span>
}
