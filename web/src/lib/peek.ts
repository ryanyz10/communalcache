// Device-local settings for the "peek inside" cache-opening animation. Nothing here is account data.
const MODE_KEY = 'cc_peek_mode', SEEN_KEY = 'cc_peek_seen'
// ponytail: remembered per browser, not per account; a shared browser shows the peek once per cache, not per person.
const SEEN_CAP = 200

export type PeekMode = 'always' | 'first' | 'never'

// The OS-level accessibility setting. It wins over every mode: with it on, the animation never plays.
export function motionAllowed() {
  return typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function getPeekMode(): PeekMode {
  try {
    const stored = localStorage.getItem(MODE_KEY)
    return stored === 'first' || stored === 'never' ? stored : 'always'
  } catch { return 'always' }
}

export function setPeekMode(mode: PeekMode) {
  try { if (mode === 'always') localStorage.removeItem(MODE_KEY); else localStorage.setItem(MODE_KEY, mode) } catch { /* storage blocked: stays on "always" */ }
}

function seenCaches(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch { return [] }
}

export function markPeeked(cacheId: string) {
  const seen = seenCaches()
  if (seen.includes(cacheId)) return
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, cacheId].slice(-SEEN_CAP))) } catch { /* storage blocked */ }
}

export function shouldPeek(cacheId: string) {
  if (!motionAllowed()) return false
  const mode = getPeekMode()
  return mode === 'always' || (mode === 'first' && !seenCaches().includes(cacheId))
}
