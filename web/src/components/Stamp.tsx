import type { ReactNode } from 'react'

export function Stamp({ tone = 'muted', children }: { tone?: 'muted' | 'ok' | 'warn'; children: ReactNode }) {
  return <span className={`cc-stamp cc-stamp-${tone}`}>{children}</span>
}
