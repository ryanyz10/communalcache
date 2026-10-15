export const CACHE_OPEN_MS = 400
const reducedMotion = '(prefers-reduced-motion: reduce)'

export function motionAllowed() {
  return typeof matchMedia === 'function' && !matchMedia(reducedMotion).matches && !document.hidden
}

export function plainLinkClick(event: { button: number; defaultPrevented: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) {
  return event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export function openCache(link: Element, navigate: () => void) {
  if (!motionAllowed()) { navigate(); return }
  const preference = matchMedia(reducedMotion)
  let finished = false
  link.setAttribute('data-opening', 'true')
  function cleanup() {
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', skip)
    preference.removeEventListener('change', skip)
    link.removeAttribute('data-opening')
  }
  function finish() {
    if (finished) return
    finished = true
    cleanup()
    navigate()
  }
  function skip() { if (document.hidden || preference.matches) finish() }
  // Navigation never depends on animationend (CSS can be disabled or interrupted).
  const timer = setTimeout(finish, CACHE_OPEN_MS)
  document.addEventListener('visibilitychange', skip)
  preference.addEventListener('change', skip)
  return () => { finished = true; cleanup() }
}

export function walkerPose(elapsed: number, distance: number) {
  const travel = Math.max(1, distance / 14 * 1000), pause = 1400
  const phase = elapsed % (travel * 2 + pause * 2)
  if (phase < travel) return { x: Math.round(distance * phase / travel), direction: 1, walking: true }
  if (phase < travel + pause) return { x: distance, direction: 1, walking: false }
  if (phase < travel * 2 + pause) return { x: Math.round(distance * (1 - (phase - travel - pause) / travel)), direction: -1, walking: true }
  return { x: 0, direction: -1, walking: false }
}

export function bindWalker(cat: SVGSVGElement) {
  const preference = matchMedia(reducedMotion)
  let frame = 0, elapsed = 0, last: number | undefined
  let distance = 0
  function measure() {
    distance = Math.max(0, Math.floor(cat.parentElement!.clientWidth - cat.getBoundingClientRect().width - 40))
  }
  function tick(now: number) {
    if (last !== undefined) elapsed += now - last
    last = now
    const pose = walkerPose(elapsed, distance)
    cat.style.transform = `translate3d(${20 + pose.x}px,0,0) scaleX(${pose.direction})`
    cat.dataset.walking = String(pose.walking)
    frame = requestAnimationFrame(tick)
  }
  function sync() {
    cancelAnimationFrame(frame)
    last = undefined
    if (!motionAllowed()) {
      cat.dataset.walking = 'false'
      if (preference.matches) { elapsed = 0; cat.style.transform = '' }
      return
    }
    measure()
    if (cat.getClientRects().length) frame = requestAnimationFrame(tick)
  }
  document.addEventListener('visibilitychange', sync)
  preference.addEventListener('change', sync)
  window.addEventListener('resize', sync)
  sync()
  return () => {
    cancelAnimationFrame(frame)
    document.removeEventListener('visibilitychange', sync)
    preference.removeEventListener('change', sync)
    window.removeEventListener('resize', sync)
  }
}

export function bindTabMotion() {
  function sync() { document.documentElement.classList.toggle('cc-motion-paused', document.hidden) }
  document.addEventListener('visibilitychange', sync)
  sync()
  return () => {
    document.removeEventListener('visibilitychange', sync)
    document.documentElement.classList.remove('cc-motion-paused')
  }
}

export function fadeRoute(content: HTMLElement) {
  if (!motionAllowed() || typeof content.animate !== 'function') return
  const preference = matchMedia(reducedMotion)
  const animation = content.animate([{ opacity: 0.65 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' })
  function skip() { if (document.hidden || preference.matches) animation.cancel() }
  document.addEventListener('visibilitychange', skip)
  preference.addEventListener('change', skip)
  return () => {
    animation.cancel()
    document.removeEventListener('visibilitychange', skip)
    preference.removeEventListener('change', skip)
  }
}
