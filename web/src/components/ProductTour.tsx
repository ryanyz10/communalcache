import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import type { Me } from '../lib/api'
import { meKey } from '../lib/profile'
import { peekJoinToken } from '../lib/pendingJoin'
import { saveTourCompletion, shouldStartTour, spotlightLayout, tourSteps } from '../lib/tour'

const TourContext = createContext<(() => void) | null>(null)
type Session = { userId: string; step: number }

export function ProductTourProvider({ children }: { children: ReactNode }) {
  const { ready, me } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const attempted = useRef(new Set<string>())
  const pending = useRef(Promise.resolve())
  const writer = useRef<AbortController | null>(null)
  const identity = useRef<string | null>(null)
  const lastPath = useRef(pathname)
  identity.current = ready ? me?.id ?? null : null
  const active = ready && session?.userId === me?.id ? session : null

  useEffect(() => {
    const controller = new AbortController()
    writer.current = controller
    return () => controller.abort()
  }, [ready, me?.id])

  useEffect(() => {
    const moved = lastPath.current !== pathname
    lastPath.current = pathname
    if (ready && session && (session.userId !== me?.id || (moved && pathname !== tourSteps[session.step].path))) setSession(null)
  }, [ready, me?.id, pathname, session])

  useEffect(() => {
    if (!me || !shouldStartTour(ready, me, pathname, !!peekJoinToken()) || attempted.current.has(me.id)) return
    attempted.current.add(me.id)
    setSession({ userId: me.id, step: 0 })
  }, [ready, me, pathname])

  function persist(completed: boolean) {
    if (!me || identity.current !== me.id || !writer.current) return
    const userId = me.id, signal = writer.current.signal
    client.setQueryData<Me | null>(meKey(), current => current?.id === userId
      ? { ...current, tour_completed_at: completed ? Date.now() : null } : current)
    // Keep a slow finish/retry from overwriting a newer replay (or vice versa).
    pending.current = pending.current.then(() => saveTourCompletion(completed,
      () => identity.current === userId && client.getQueryData<Me | null>(meKey())?.id === userId, signal))
  }

  function replay() {
    if (!me?.display_name || !ready) return
    persist(false)
    attempted.current.add(me.id)
    setSession({ userId: me.id, step: 0 })
    navigate('/')
  }
  function finish() {
    persist(true)
    setSession(null)
  }
  function go(step: number) {
    if (!active || pathname !== tourSteps[active.step].path) return
    setSession({ userId: active.userId, step })
    navigate(tourSteps[step].path)
  }

  return <TourContext.Provider value={replay}>
    {children}
    {active && <Spotlight
      key={active.userId} step={active.step} pathname={pathname} onBack={() => go(active.step - 1)}
      onNext={() => active.step === tourSteps.length - 1 ? finish() : go(active.step + 1)} onSkip={finish}
    />}
  </TourContext.Provider>
}

export function ReplayTourButton() {
  const replay = useContext(TourContext)
  return <button type="button" data-tour-replay className="cc-profile-secondary" disabled={!replay} onClick={() => replay?.()}>Replay tour</button>
}

export function Spotlight({ step, pathname, onBack, onNext, onSkip }: {
  step: number; pathname?: string; onBack: () => void; onNext: () => void; onSkip: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const current = tourSteps[step]
  const navigating = pathname !== undefined && pathname !== current.path
  const [layout, setLayout] = useState<ReturnType<typeof spotlightLayout> | null>(null)
  const lastTarget = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const modal = dialog.current!
    const previous = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    const overflow = document.documentElement.style.overflow
    modal.showModal()
    document.documentElement.style.overflow = 'hidden'
    return () => {
      modal.close()
      document.documentElement.style.overflow = overflow
      if (previous?.isConnected) previous.focus()
      else {
        const replay = previous?.hasAttribute('data-tour-replay') ? document.querySelector<HTMLElement>('[data-tour-replay]') : null
        const target = replay ?? (lastTarget.current?.isConnected ? lastTarget.current : null) ?? document.querySelector<HTMLElement>('main h1')
        if (target?.isConnected) {
          if (!target.matches('a[href],button,input,select,textarea,[tabindex]')) target.setAttribute('tabindex', '-1')
          target.focus()
        }
      }
    }
  }, [])

  useLayoutEffect(() => {
    let frame = 0
    function measure() {
      const target = [...document.querySelectorAll<HTMLElement>(`[data-tour="${current.id}"]`)]
        .find(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0) ?? null
      lastTarget.current = target
      const padding = getComputedStyle(dialog.current!)
      const safe = { top: parseFloat(padding.paddingTop) || 0, right: parseFloat(padding.paddingRight) || 0,
        bottom: parseFloat(padding.paddingBottom) || 0, left: parseFloat(padding.paddingLeft) || 0 }
      const next = spotlightLayout(target?.getBoundingClientRect() ?? null, window.innerWidth, window.innerHeight, card.current?.offsetHeight ?? 240, safe)
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    // Replay may inherit a scrolled Account page; reveal the real target instantly.
    if (pathname === undefined || pathname === current.path) {
      const target = [...document.querySelectorAll<HTMLElement>(`[data-tour="${current.id}"]`)]
        .find(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0)
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    }
    measure()
    heading.current?.focus()
    const observer = new ResizeObserver(schedule)
    if (card.current) observer.observe(card.current)
    for (const target of document.querySelectorAll(`[data-tour="${current.id}"]`)) observer.observe(target)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [current.id, pathname])

  const hole = layout?.hole
  return <dialog ref={dialog} role="dialog" aria-modal="true" className={`cc-tour${hole ? '' : ' cc-tour-centered'}`}
    aria-labelledby="tour-heading" aria-describedby="tour-description tour-progress"
    onCancel={event => { event.preventDefault(); onSkip() }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const first = buttons[0], last = buttons.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }}>
    {hole && <div aria-hidden="true" className="cc-tour-hole" style={{ left: hole.left, top: hole.top, width: hole.right - hole.left, height: hole.bottom - hole.top }} />}
    <div ref={card} className="cc-tour-card" style={layout ? { left: layout.card.left, top: layout.card.top, width: layout.card.width } : undefined}>
      <p id="tour-progress" className="cc-tour-progress" aria-live="polite" aria-atomic="true">Step {step + 1} of {tourSteps.length}</p>
      <h2 ref={heading} tabIndex={-1} id="tour-heading">{current.title}</h2>
      <p id="tour-description">{current.text}</p>
      <div className="cc-tour-actions">
        <button type="button" className="cc-text-action" onClick={onSkip}>Skip</button>
        <button type="button" className="cc-profile-secondary" disabled={step === 0 || navigating} onClick={onBack}>Back</button>
        <button type="button" className="cc-profile-primary" disabled={navigating} onClick={onNext}>{step === tourSteps.length - 1 ? 'Finish' : 'Next'}</button>
      </div>
    </div>
  </dialog>
}
