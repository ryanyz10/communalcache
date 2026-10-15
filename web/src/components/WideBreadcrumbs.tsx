import type { ReactNode } from 'react'

export function WideBreadcrumbs({ children }: { children: ReactNode }) {
  return <nav aria-label="Breadcrumb" className="hidden lg:flex lg:flex-wrap lg:items-center lg:gap-2 lg:text-sm lg:text-slate-600">{children}</nav>
}
