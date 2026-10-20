import { Shimmer, LoadingStatus } from '../Skeleton'

export function LibrarySkeleton({ filter = 'all' }: {filter?:string}) {
  return <main className="organic-library cc-page-skeleton" data-skeleton="library" aria-busy="true">
    <LoadingStatus label="Loading your items…" />
    <div className="cc-library-header"><h1>Your items</h1><button disabled className="cc-profile-primary cc-library-new"><span className="cc-phone-copy">+ New</span><span className="cc-desktop-copy">+ New item</span></button></div>
    <section className="cc-library-contents">
      <div className="cc-library-filters">{[['all','All'],['lend','Lend'],['give','Give'],['unshared','Not shared']].map(([value,label])=><button disabled aria-pressed={filter===value} key={value}>{label}</button>)}</div>
      <ul className="cc-library-grid" aria-hidden="true">{Array.from({length:6},(_,index)=><li key={index} className="cc-library-tile">
        <div className="cc-library-photo-skeleton cc-shimmer" />
        <div className="cc-library-caption"><Shimmer width="78%" height={14} /><Shimmer width="40%" height={12} /></div>
      </li>)}</ul>
    </section>
  </main>
}
