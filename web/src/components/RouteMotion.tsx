import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { bindTabMotion, fadeRoute } from '../lib/motion'

export function RouteMotion({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const content = useRef<HTMLDivElement>(null)
  useEffect(bindTabMotion, [])
  useEffect(() => { if (content.current) return fadeRoute(content.current) }, [pathname])
  return <div ref={content}>{children}</div>
}
