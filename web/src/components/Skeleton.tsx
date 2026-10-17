import type { CSSProperties } from 'react'

export function Shimmer({ width = '100%', height = 12, round = false, className = '' }: {
  width?: CSSProperties['width']
  height?: number
  round?: boolean
  className?: string
}) {
  return <span aria-hidden="true" className={`cc-shimmer ${className}`} style={{ width, height, ...(round ? { borderRadius: '50%' } : {}) }} />
}

export function LoadingStatus({ label }: { label: string }) {
  return <span role="status" className="sr-only">{label}</span>
}

export function LoadingLines({ label, className = '' }: { label: string; className?: string }) {
  return <div className={`cc-skeleton-lines ${className}`}>
    <LoadingStatus label={label} />
    <Shimmer width="72%" />
    <Shimmer width="46%" height={10} />
  </div>
}

export function SkeletonRows({ label, count = 4, kind = 'contents' }: {
  label: string
  count?: number
  kind?: 'contents' | 'library' | 'members' | 'requests' | 'plain'
}) {
  return <div className={`cc-packing-slip cc-skeleton-rows cc-skeleton-${kind}`}>
    <LoadingStatus label={label} />
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, index) => <div className="cc-skeleton-row" key={index}>
        <Shimmer width={kind === 'members' ? 32 : 44} height={kind === 'members' ? 32 : 44} round={kind === 'members' || kind === 'requests'} className="cc-skeleton-tile" />
        <div className="cc-skeleton-row-copy">
          <Shimmer width={['64%', '50%', '72%', '58%'][index % 4]} />
          {kind !== 'members' && <Shimmer width={['30%', '24%', '34%', '28%'][index % 4]} height={10} />}
        </div>
        <Shimmer width={58} height={10} className="cc-skeleton-row-end" />
        {kind === 'contents' && <>
          <Shimmer width={['64%', '50%', '72%', '58%'][index % 4]} className="cc-skeleton-desktop-title" />
          <span className="cc-skeleton-desktop-from"><Shimmer width={26} height={26} round /><Shimmer width={56} height={10} /></span>
          <Shimmer width={58} height={10} className="cc-skeleton-desktop-status" />
        </>}
      </div>)}
    </div>
  </div>
}
