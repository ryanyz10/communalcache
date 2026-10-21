import { Link } from 'react-router'
import { Shimmer, LoadingStatus, SkeletonRows } from '../Skeleton'

export function ItemSkeleton({ cacheId }: { cacheId?: string }) {
  return <main className="cc-owner-item-detail cc-page-skeleton" data-skeleton="item" aria-busy="true">
    <LoadingStatus label="Loading item…" />
    <div className="cc-owner-item-layout">
      <div className="cc-owner-hero">
        <Shimmer height={240} className="cc-item-photo-frame" />
        <nav className="cc-owner-hero-links" aria-label="Item actions"><Link to={cacheId ? `/caches/${cacheId}` : '/items'}>‹ Back</Link>{!cacheId && <button disabled>Edit</button>}</nav>
      </div>
      <div className="cc-owner-info">
        <Shimmer width="76%" height={36} /><Shimmer width={90} height={18} />
        {cacheId ? <SkeletonRows label="Loading item details…" count={2} kind="plain" /> : <>
          <section className="cc-item-availability"><h2>Availability</h2><div className="cc-item-availability-row"><Shimmer width={90} height={18} /><Shimmer width={132} height={40} /></div></section>
          <section className="cc-item-caches"><h2>In caches</h2><Shimmer width={160} height={32} /></section>
        </>}
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
