import type { MouseEvent } from 'react'
import { markPeeked, shouldPeek } from '../lib/peek'

// The tapped box's handle hole grows over the screen, a cat looks around in the dark, then the dark
// shrinks into the open box's handle. Timeline: grow 0-700ms, route swap at 700ms, shrink ends at 2100ms.
const GROW = 700
const HOLD = 650
const SHRINK = 750
const LOAD_WAIT = 3000
const DEST = '.cc-cache-box .cc-box-handle'
const EYES = '<svg viewBox="0 0 60 20" style="display:block;width:100%;height:auto"><g class="cc-peek-look"><ellipse cx="20" cy="10" rx="4.5" ry="5.5" fill="#f6a06b"/><ellipse cx="40" cy="10" rx="4.5" ry="5.5" fill="#f6a06b"/><ellipse cx="20" cy="10" rx="1.3" ry="4" fill="#201e1d"/><ellipse cx="40" cy="10" rx="1.3" ry="4" fill="#201e1d"/></g></svg>'

let playing = false
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// Smallest scale at which a pill of this height covers the viewport from its own centre.
function coverScale(rect: DOMRect) {
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const farthest = Math.hypot(Math.max(centerX, innerWidth - centerX), Math.max(centerY, innerHeight - centerY))
  return Math.ceil((2 * farthest) / rect.height) + 2
}

function place(element: HTMLElement, rect: DOMRect) {
  Object.assign(element.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
}

async function destinationHole() {
  const deadline = performance.now() + LOAD_WAIT
  for (;;) {
    const handle = document.querySelector<HTMLElement>(DEST)
    if (handle) return handle.getBoundingClientRect()
    if (performance.now() > deadline) return null
    await wait(50)
  }
}

async function playPeek(handle: HTMLElement, cacheId: string, navigate: () => void) {
  playing = true
  const sourceRect = handle.getBoundingClientRect()
  const overlay = document.createElement('div')
  const eyes = document.createElement('div')
  overlay.className = 'cc-hole-overlay'
  eyes.className = 'cc-peek-eyes'
  overlay.setAttribute('aria-hidden', 'true')
  eyes.setAttribute('aria-hidden', 'true')
  eyes.innerHTML = EYES
  eyes.style.opacity = '0'
  place(overlay, sourceRect)
  document.body.append(overlay, eyes)
  try {
    const grow = overlay.animate(
      [{ transform: 'scale(1)' }, { transform: `scale(${coverScale(sourceRect)})` }],
      { duration: GROW, easing: 'cubic-bezier(.55,0,.85,.35)', fill: 'forwards' },
    )
    await grow.finished
    navigate()
    markPeeked(cacheId)
    scrollTo(0, 0)
    eyes.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: 'forwards' })
    await wait(HOLD)
    // Keep the cat looking while an uncached cache loads; fade out instead if it never arrives.
    const destinationRect = await destinationHole()
    eyes.remove()
    if (!destinationRect) {
      await overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).finished
      return
    }
    grow.cancel()
    place(overlay, destinationRect)
    await overlay.animate(
      [{ transform: `scale(${coverScale(destinationRect)})` }, { transform: 'scale(1)' }],
      { duration: SHRINK, easing: 'cubic-bezier(.15,.65,.25,1)' },
    ).finished
  } finally {
    overlay.remove()
    eyes.remove()
    playing = false
  }
}

// Click handler for a Home box link. Plain navigation (no overlay) when motion is off, the peek is
// spent for this cache, or the click is a modified/new-tab click.
export function openCacheWithPeek(event: MouseEvent<HTMLElement>, cacheId: string, navigate: () => void) {
  if (playing) {
    event.preventDefault()
    return
  }
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  if (!shouldPeek(cacheId)) return
  const handle = event.currentTarget.querySelector<HTMLElement>('.cc-box-handle')
  if (!handle) return
  event.preventDefault()
  void playPeek(handle, cacheId, navigate)
}
