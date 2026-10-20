import { Link } from 'react-router'
import { Shimmer, LoadingStatus, SkeletonRows } from '../Skeleton'

export function ItemSkeleton({ cacheId }: { cacheId?: string }) {
  if (!cacheId) return <main className="cc-owner-item-detail cc-page-skeleton" data-skeleton="item" aria-busy="true">
    <LoadingStatus label="Loading item…" />
    <div className="cc-owner-item-layout">
      <div className="cc-owner-hero">
        <Shimmer height={240} className="cc-item-photo-frame" />
        <nav className="cc-owner-hero-links" aria-label="Item actions"><Link to="/items">‹ Back</Link><button disabled>Edit</button></nav>
      </div>
      <div className="cc-owner-info">
        <Shimmer width="76%" height={36} /><Shimmer width={90} height={18} />
        <section className="cc-item-availability"><h2>Availability</h2><div className="cc-item-availability-row"><Shimmer width={90} height={18} /><Shimmer width={132} height={40} /></div></section>
        <section className="cc-item-caches"><h2>In caches</h2><Shimmer width={160} height={32} /></section>
      </div>
    </div>
  </main>
  return <main className="organic-item-detail cc-page-skeleton" data-skeleton="item" aria-busy="true">
    <LoadingStatus label="Loading item…" />
    <nav className="cc-item-breadcrumb"><Link to={`/caches/${cacheId}`}>‹ Back to cache</Link></nav>
    <div className="cc-organic-item-layout">
      <div className="cc-item-art"><Shimmer height={200} className="cc-item-photo-frame cc-skeleton-item-photo" /></div>
      <div className="cc-organic-item-copy">
        <Shimmer width="78%" height={36} />
        <dl className="cc-item-info-slip">{['From','Kind','In','Note'].map(label=><div key={label} className={label==='In'?'cc-item-context':undefined}><dt>{label}</dt><dd><Shimmer width={150} height={14} /></dd></div>)}</dl>
        <SkeletonRows label="Loading requests…" count={2} kind="requests" />
      </div>
    </div>
  </main>
}

export function ItemEditorSkeleton({ editing = false }: { editing?: boolean }) {
  return <main className="cc-page cc-page-skeleton" data-skeleton="editor" aria-busy="true">
    <h1>{editing ? 'Edit item' : 'New item'}</h1>
    <LoadingStatus label="Loading item form…" />
    <div className="cc-item-fields">
      {!editing && <Shimmer height={150} className="cc-skeleton-field" />}
      <Shimmer height={editing ? 20 : 46} />
      <div className="cc-item-title-field"><label>What is it?</label><Shimmer height={50} /></div>
      {editing ? <div className="cc-item-note-field"><span>Note (optional)</span><Shimmer height={90} className="cc-skeleton-field" /></div> : <><span>Put it in</span><Shimmer width="76%" height={38} /></>}
    </div>
  </main>
}
