import { Link } from 'react-router'
import { Shimmer, LoadingStatus, LoadingLines, SkeletonRows } from '../Skeleton'

export function ItemSkeleton({ cacheId }: { cacheId?: string }) {
  return <main className="organic-item-detail cc-page-skeleton" data-skeleton="item" aria-busy="true">
    <LoadingStatus label="Loading item…" />
    <nav className="cc-item-breadcrumb">
      <Link to={cacheId ? `/caches/${cacheId}` : '/items'}>‹ {cacheId ? 'Back to cache' : 'Your items'}</Link>
    </nav>
    <div className="cc-organic-item-layout">
      <div className="cc-item-art"><Shimmer height={200} className="cc-item-photo-frame cc-skeleton-item-photo" /></div>
      <div className="cc-organic-item-copy">
        <Shimmer width="78%" height={36} />
        <dl className="cc-item-info-slip">
          {['From', 'Kind', 'In', 'Note'].map(label => <div
            key={label}
            className={label === 'In' ? 'cc-item-context' : undefined}
          >
            <dt>{label}</dt>
            <dd><Shimmer width={150} height={14} /></dd>
          </div>)}
        </dl>
        {cacheId ? <SkeletonRows label="Loading requests…" count={2} kind="requests" /> : <div className="cc-owner-item-controls">
          <div className="cc-inline-actions">
            <button disabled className="cc-profile-primary">Edit item</button>
            <button disabled className="cc-profile-secondary cc-delete-item">Delete item</button>
          </div>
          <section className="cc-owner-availability">
            <h2>Availability</h2>
            <div className="cc-owner-availability-toggle">
              <span>Lent out</span>
              <Shimmer width={48} height={28} />
            </div>
            <span>Lent out note (optional)</span>
            <Shimmer height={50} />
            <p className="cc-form-hint">Up to 200 characters. This blocks new requests, not existing pending requests.</p>
            <button disabled className="cc-profile-secondary">Save availability</button>
          </section>
          <section className="cc-owner-sharing">
            <h2>Shown in</h2>
            <p className="cc-form-hint">Choose which caches can see this item. Stock and availability are shared everywhere.</p>
            <SkeletonRows label="Loading sharing…" kind="plain" count={2} />
          </section>
          <section className="cc-owner-photo">
            <h2>Photo</h2>
            <Shimmer height={48} />
            <LoadingLines label="Loading photo…" />
          </section>
        </div>}
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
      {editing ? <div className="cc-item-description-editor">
        <span>Description (optional)</span>
        <Shimmer height={90} className="cc-skeleton-field" />
      </div> : <>
        <span>Put it in</span>
        <Shimmer width="76%" height={38} />
      </>}
    </div>
  </main>
}
