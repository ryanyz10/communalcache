import { Shimmer, SkeletonRows } from '../Skeleton'
import { Stamp } from '../Stamp'
import { Cat } from '../Cat'
import type { Me } from '../../lib/api'

const TOTALS_PLACEHOLDER_WIDTH = 180
const FILTER_LABELS = [
  ['all', 'All', 'All'],
  ['lend', 'To lend', 'Lend'],
  ['give', 'To give', 'Give'],
  ['unshared', 'Not shared yet', 'Not shared'],
] as const

type LibrarySkeletonProps = {
  user?: Me
  filter?: string
  pendingAnswerCount?: number
}

export function LibrarySkeleton({ user, filter = 'all', pendingAnswerCount }: LibrarySkeletonProps) {
  return <main className="organic-library cc-page-skeleton" data-skeleton="library" aria-busy="true">
    <div className="cc-library-hero">
      {user && <span className="cc-library-cat" aria-hidden="true">
        <Cat userId={user.id} coat={user.cat_coat} pose="sit" />
      </span>}
      <span className="cc-box-handle" />
      {!!pendingAnswerCount && <span className="cc-library-asks">
        <Stamp tone="warn">
          {pendingAnswerCount} {pendingAnswerCount === 1 ? 'ask' : 'asks'}
          <span className="cc-desktop-copy"> waiting</span>
        </Stamp>
      </span>}
      <div>
        <h1>{user?.display_name ? `${user.display_name}'s things` : 'Your items'}</h1>
        <Shimmer width={TOTALS_PLACEHOLDER_WIDTH} height={14} />
      </div>
      <span className="cc-library-new">+ New item</span>
    </div>
    <section className="cc-library-contents">
      <div className="cc-library-filters">
        {FILTER_LABELS.map(([value, wide, phone]) => <button disabled aria-pressed={filter === value} key={value}>
          <span className="cc-desktop-copy">{wide}</span>
          <span className="cc-phone-copy">{phone}</span>
        </button>)}
      </div>
      <div className="cc-library-slip"><SkeletonRows label="Loading your items…" kind="library" /></div>
    </section>
  </main>
}
