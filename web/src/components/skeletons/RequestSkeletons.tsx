import { Link } from 'react-router'
import { Shimmer, LoadingLines, SkeletonRows } from '../Skeleton'

type RequestsSkeletonProps = {
  embedded?: boolean
  pendingAnswerCount?: number
}

export function RequestsSkeleton({ embedded = false, pendingAnswerCount }: RequestsSkeletonProps) {
  const columns = <div className="cc-request-columns">
    <div className="cc-request-owned">
      {['Needs your answer', 'Answered for your things'].map((label, index) => <section
        className="cc-request-group"
        key={label}
      >
        <div className="cc-request-group-heading">
          <h2>{label}</h2>
          {index === 0 && !!pendingAnswerCount && <span>{pendingAnswerCount}</span>}
        </div>
        <SkeletonRows
          label={`Loading ${label.toLowerCase()}…`}
          count={index === 0 ? 2 : 1}
          kind="requests"
        />
      </section>)}
    </div>
    <section className="cc-request-group">
      <div className="cc-request-group-heading"><h2>Your asks</h2></div>
      <SkeletonRows label="Loading your asks…" count={2} kind="requests" />
    </section>
  </div>

  return embedded ? columns : <main
    className="organic-requests cc-page-skeleton"
    data-skeleton="requests"
    aria-busy="true"
  >
    <h1>Requests</h1>
    {columns}
  </main>
}

export function RequestDetailSkeleton({ embedded = false }: { embedded?: boolean }) {
  const body = <>
    <div className="cc-approved-item"><Shimmer height={150} className="cc-approved-name-tile" /></div>
    <div className="cc-approved-copy">
      <Shimmer width="86%" height={38} />
      <LoadingLines label="Loading ask…" />
      <div className="cc-focused-contact">
        <Shimmer width="48%" height={12} />
        <Shimmer height={44} />
      </div>
    </div>
  </>

  return embedded ? body : <main
    className="organic-request-detail cc-page-skeleton"
    data-skeleton="request-detail"
    aria-busy="true"
  >
    <nav className="cc-request-back"><Link to="/requests">‹ Requests</Link></nav>
    {body}
  </main>
}
