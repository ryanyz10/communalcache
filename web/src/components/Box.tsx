import type { ReactNode } from 'react'
import { catHash } from '../lib/cats'

const BOX_COLORS = ['#f6a06b', '#aebf92', '#dcd3c4'] as const
export function boxColor(id: string) { return BOX_COLORS[catHash(id) % BOX_COLORS.length] }

export function Box({ id, label, compact = false, children }: { id: string; label: string; compact?: boolean; children?: ReactNode }) {
  return <span className={`cc-box${compact ? ' cc-box-compact' : ''}`} style={{ background: boxColor(id) }}>
    <span className="cc-box-handle" />
    <span className="cc-box-label">{label}</span>
    {children}
  </span>
}

export function BoxMark({ size = 30 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="M8 15 L9 4 L15 10 Z M24 15 L23 4 L17 10 Z" fill="#82796a" />
    <path d="M6 15 C6 9 10 8 16 8 C22 8 26 9 26 15 Z" fill="#82796a" />
    <rect x="3" y="13" width="26" height="17" rx="5" fill="#f6a06b" />
    <rect x="3" y="13" width="26" height="5" rx="2.5" fill="rgba(32,30,29,.16)" />
  </svg>
}
