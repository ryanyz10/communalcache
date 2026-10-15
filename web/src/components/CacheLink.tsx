import { useEffect, useRef } from 'react'
import { Link, useNavigate, type LinkProps } from 'react-router'
import { openCache, plainLinkClick } from '../lib/motion'

export function CacheLink({ to, children, className = '', ...props }: LinkProps) {
  const navigate = useNavigate()
  const pending = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => pending.current?.(), [])
  return <Link {...props} to={to} className={`cc-cache-link ${className}`} onClick={event => {
    props.onClick?.(event)
    if (!plainLinkClick(event) || (props.target && props.target !== '_self') || props.reloadDocument) return
    event.preventDefault()
    if (pending.current) return
    pending.current = openCache(event.currentTarget, () => { pending.current = undefined; void navigate(to) })
  }}>{children}</Link>
}
