import { Shimmer, LoadingStatus, SkeletonRows } from '../Skeleton'
import { greeting } from '../../lib/caches'

export function HomeBoxesSkeleton() {
  return <div className="cc-home-boxes cc-skeleton-boxes">
    <LoadingStatus label="Loading caches…" />
    {[0, 1, 2].map(index => <div className="cc-labelled-cache" key={index}>
      <div className="cc-box cc-skeleton-home-box">
        <span className="cc-box-handle" />
        <Shimmer width="76%" height={30} />
        <Shimmer width="48%" height={12} />
      </div>
    </div>)}
  </div>
}

export function HomeSkeleton() {
  return <main className="organic-home cc-page-skeleton" data-skeleton="home" aria-busy="true">
    <button type="button" disabled className="cc-home-plus" aria-label="New cache or join with an invite">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M5 12h14M12 5v14" />
      </svg>
    </button>
    <div className="cc-home-title">
      <div><p>{greeting(new Date().getHours())}</p><h1>Your caches</h1></div>
      <div className="cc-home-desktop-actions">
        <button disabled className="cc-profile-secondary">Join with an invite</button>
        <button disabled className="cc-profile-primary">+ New cache</button>
      </div>
    </div>
    <HomeBoxesSkeleton />
    <div className="cc-home-slips">
      <section>
        <div className="cc-slip-title"><h2>Your things</h2></div>
        <SkeletonRows label="Loading your items…" count={3} kind="library" />
      </section>
      <section>
        <div className="cc-slip-title"><h2>Your asks</h2></div>
        <SkeletonRows label="Loading your asks…" count={2} kind="requests" />
      </section>
    </div>
  </main>
}
