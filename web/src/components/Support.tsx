import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { landingCopy } from '../lib/landingCopy'
import { SUPPORT_URL } from '../lib/support'

const copy = landingCopy.support

export function SupportLink({ children = copy.heading, className = 'inline-flex min-h-11 items-center text-sm text-slate-600 underline underline-offset-4' }: { children?: ReactNode; className?: string }) {
  if (!SUPPORT_URL) return null
  return <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className={className}>{children}<span className="sr-only"> (opens in a new tab)</span></a>
}

export function SupportCard() {
  if (!SUPPORT_URL) return null
  return <section className="cc-account-support" aria-labelledby="support-heading"><div><h2 id="support-heading">{copy.heading}</h2><p>{copy.description}</p></div><SupportLink className="cc-profile-secondary">{copy.button}</SupportLink></section>
}

export function AppFooter() {
  const { me } = useAuth()
  const { pathname } = useLocation()
  if (!SUPPORT_URL || !me?.display_name || pathname === '/login' || pathname === '/auth/link' || pathname === '/account' || pathname.startsWith('/requests/') || /^\/(?:caches\/[^/]+\/)?items\/.+/.test(pathname) || pathname.startsWith('/join/')) return null
  return <footer className="cc-support-footer"><SupportLink /></footer>
}
