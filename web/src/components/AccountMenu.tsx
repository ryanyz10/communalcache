import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/api'
import { accountMenuLabel, bindAccountMenu } from '../lib/accountMenu'

export function AccountMenu({ name, count }: { name: string; count: number }) {
  const { signOut } = useAuth()
  const { pathname, key } = useLocation()
  const previousLocation = useRef(key)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open || !root.current || !trigger.current || !menu.current) return
    return bindAccountMenu(root.current, trigger.current, menu.current, () => setOpen(false))
  }, [open])
  useEffect(() => {
    if (previousLocation.current === key) return
    previousLocation.current = key
    if (open) { setOpen(false); trigger.current?.focus() }
  }, [key, open])
  function close() { setOpen(false); trigger.current?.focus() }
  async function logout() {
    setPending(true); setError('')
    try { await signOut() } catch (error) { setError(errorMessage(error)) } finally { setPending(false) }
  }
  const badge = count > 0 && <span aria-hidden="true" className="min-w-[18px] rounded-full bg-red-700 px-[5px] text-center text-[11px] leading-[18px] font-semibold text-white">{count}</span>
  return <div ref={root} className="relative">
    <button ref={trigger} type="button" aria-label={accountMenuLabel(count)} aria-haspopup="menu" aria-expanded={open} aria-controls="account-menu" onClick={() => { if (open) close(); else setOpen(true) }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) } }} className={`flex min-h-11 items-center gap-1.5 rounded-full border py-[3px] pr-2 pl-[3px] lg:gap-2 lg:pr-2.5 ${open ? 'border-slate-300 bg-slate-100' : 'border-slate-200 bg-white'}`}>
      <span aria-hidden="true" className="flex size-[30px] items-center justify-center rounded-full bg-slate-900 text-[13px] font-semibold text-white">{Array.from(name.trim())[0]?.toUpperCase() ?? '?'}</span>
      <span className="hidden lg:inline lg:max-w-[240px] lg:truncate lg:font-medium">{name}</span>{badge}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <div ref={menu} id="account-menu" role="menu" aria-label="Account menu" hidden={!open} className="absolute top-[calc(100%+8px)] right-0 z-30 w-60 max-w-[calc(100vw-2rem)] rounded-[14px] border border-slate-200 bg-white p-1.5 text-slate-900 shadow-[0_12px_30px_rgb(15_23_42/18%)]">
      <div role="presentation" className="border-b border-slate-100 px-3 py-2.5"><p className="break-words font-semibold">{name}</p><p className="text-sm text-slate-600">Signed in</p></div>
      <Link to="/requests" role="menuitem" tabIndex={-1} onClick={close} aria-label={count > 0 ? `Requests, ${count} pending incoming on the first page` : 'Requests'} aria-current={pathname === '/requests' ? 'page' : undefined} className="flex min-h-11 items-center justify-between rounded-lg px-3 py-2.5 font-medium hover:bg-slate-50 focus-visible:bg-slate-50">Requests{badge}</Link>
      <Link to="/account" role="menuitem" tabIndex={-1} onClick={close} aria-current={pathname === '/account' ? 'page' : undefined} className="flex min-h-11 items-center rounded-lg px-3 py-2.5 font-medium hover:bg-slate-50 focus-visible:bg-slate-50">Account settings</Link>
      <button type="button" role="menuitem" tabIndex={-1} disabled={pending} onClick={() => void logout()} className="mt-1 flex min-h-11 w-full items-center rounded-lg border-t border-slate-100 px-3 py-2.5 text-left font-medium hover:bg-slate-50 focus-visible:bg-slate-50 disabled:opacity-60">{pending ? 'Signing out…' : 'Sign out'}</button>
      {error && <p role="alert" className="px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  </div>
}
