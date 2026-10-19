import { apiFetch, type Me } from './api'

export const tourSteps = [
  { id: 'caches', path: '/', title: 'Your caches', text: 'Create a cache or join with an invite to share with people you know.' },
  { id: 'items', path: '/items', title: 'Your items', text: 'Add things you can lend or give, then choose which caches can see them.' },
  { id: 'requests', path: '/requests', title: 'Requests', text: 'Review incoming asks and follow the requests you have sent.' },
  { id: 'account', path: '/account', title: 'Make yourself at home', text: 'Set your profile, contact and notifications here, or replay this tour any time.' },
] as const

export function shouldStartTour(ready: boolean, me: Me | null, pathname: string, pendingInvite: boolean) {
  return ready && !!me?.display_name && me.tour_completed_at === null && pathname === '/' && !pendingInvite
}

export async function saveTourCompletion(completed: boolean, canSend: () => boolean, signal: AbortSignal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted || !canSend()) return
    try {
      await apiFetch('/api/me', { method: 'PATCH', body: { tour_completed: completed }, signal })
      return
    } catch { /* One silent retry; a preference write must never block the app. */ }
  }
}

type Rect = { left: number; top: number; right: number; bottom: number }
export function spotlightLayout(rect: Rect | null, width: number, height: number, cardHeight: number,
  safe = { top: 0, right: 0, bottom: 0, left: 0 }) {
  const gap = 16, left = gap + safe.left, right = width - gap - safe.right
  const minTop = gap + safe.top, bottom = height - gap - safe.bottom
  const cardWidth = Math.min(360, Math.max(0, right - left))
  const hole = rect && rect.right > 0 && rect.bottom > 0 && rect.left < width && rect.top < height
    ? { left: Math.max(4, rect.left - 6), top: Math.max(4, rect.top - 6), right: Math.min(width - 4, rect.right + 6), bottom: Math.min(height - 4, rect.bottom + 6) }
    : null
  const maxTop = Math.max(minTop, bottom - cardHeight)
  let top = Math.max(minTop, (minTop + bottom - cardHeight) / 2)
  if (hole && hole.bottom + gap + cardHeight <= bottom) top = hole.bottom + gap
  else if (hole && hole.top - gap - cardHeight >= minTop) top = hole.top - gap - cardHeight
  return {
    hole,
    card: {
      left: Math.max(left, Math.min(hole?.left ?? (left + right - cardWidth) / 2, right - cardWidth)),
      top: Math.min(top, maxTop),
      width: cardWidth,
    },
  }
}
