import type { ReactNode } from 'react'

export function AuthScreen({ children }: { children: ReactNode }) {
  return <main className="cc-auth">{children}</main>
}

export function BrandMark() {
  return <div aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-slate-900 shadow-[0_6px_16px_rgb(15_23_42/25%)]">
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M3 9.5 12 4l9 5.5v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M8 20v-6h8v6M8 14h8" /></svg>
  </div>
}

export function MailIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-[30px]" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
}
