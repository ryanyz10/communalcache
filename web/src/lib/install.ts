import { useSyncExternalStore } from 'react'
import { siteTitle } from './siteName'

export const installCopy = {
  heading: siteTitle('Add Communal Cache to your Home Screen'),
  iosStart: 'On iPhone or iPad, tap',
  share: 'Share',
  then: ', then',
  add: 'Add to Home Screen',
  notifications: 'iPhone notifications only work from the Home Screen app. Open the installed app and turn on Push notifications.',
  inApp: 'Open this page in Safari or Chrome to add it to your Home Screen.',
  android: 'Keep your cache a tap away with the Home Screen app.',
  install: 'Install',
  installing: 'Opening install…',
  notNow: 'Not now',
  never: "Don't show again",
}
const thirtyDays = 30 * 24 * 60 * 60 * 1000
// Storage-blocked dismissals must survive Home route remounts in this tab.
const sessionDismissals = new Map<string, string>()
export const installHintKey = (origin: string) => `communalcache:install-hint:${origin}`

type BrowserInfo = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>
const browserInfo = (): BrowserInfo => typeof navigator === 'undefined' ? { userAgent: '', platform: '', maxTouchPoints: 0 } : navigator
export function iosDevice(info = browserInfo()) {
  return /iPad|iPhone|iPod/i.test(info.userAgent) || (info.platform === 'MacIntel' && info.maxTouchPoints > 1)
}
export function standaloneMode() {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined' && !!(window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
}
export function installPlatform(info = browserInfo()) {
  const ios = iosDevice(info), android = /Android/i.test(info.userAgent)
  if (!ios && !android) return 'none'
  // Webview identification is best effort; these apps do not expose a reliable install API.
  if (/Instagram|FBAN|FBAV|FB_IAB|Gmail|LinkedIn|GSA\/|;\s*wv[;)\s]/i.test(info.userAgent)) return 'in-app'
  if (ios) return 'ios'
  return /Chrome|Chromium|EdgA|SamsungBrowser/i.test(info.userAgent) && !/Firefox|Fennec|Focus/i.test(info.userAgent) ? 'android' : 'none'
}
export function installHintDismissed(now = Date.now()) {
  try {
    const key = installHintKey(location.origin)
    const value = sessionDismissals.get(key) ?? localStorage.getItem(key)
    if (value === 'never') return true
    const until = Number(value)
    return Number.isFinite(until) && until > now
  } catch { return false }
}
export function dismissInstallHint(forever: boolean, now = Date.now()) {
  const key = installHintKey(location.origin)
  const value = forever ? 'never' : String(now + thirtyDays)
  try { localStorage.setItem(key, value); sessionDismissals.delete(key) }
  catch { sessionDismissals.set(key, value) }
}

export type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const initial = { standalone: false, installed: false, finished: false, prompt: null as InstallPrompt | null }
let state = initial, listening = false
const listeners = new Set<() => void>()
function update(next: typeof state) { state = next; listeners.forEach(listener => listener()) }
export function installSnapshot() { return state }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useInstallState() { return useSyncExternalStore(subscribe, installSnapshot, () => initial) }

export function startInstallTracking() {
  if (listening || typeof window === 'undefined') return () => {}
  listening = true
  const media = window.matchMedia?.('(display-mode: standalone)')
  const mode = () => update({ ...state, standalone: standaloneMode() })
  const before = (event: Event) => {
    const prompt = event as InstallPrompt
    if (installPlatform() !== 'android' || state.standalone || state.installed || state.finished || typeof prompt.prompt !== 'function' || !prompt.userChoice) return
    event.preventDefault()
    update({ ...state, prompt })
  }
  const installed = () => update({ ...state, installed: true, finished: true, prompt: null })
  mode()
  window.addEventListener('beforeinstallprompt', before)
  window.addEventListener('appinstalled', installed)
  if (media?.addEventListener) media.addEventListener('change', mode)
  else media?.addListener?.(mode)
  return () => {
    window.removeEventListener('beforeinstallprompt', before)
    window.removeEventListener('appinstalled', installed)
    if (media?.removeEventListener) media.removeEventListener('change', mode)
    else media?.removeListener?.(mode)
    listening = false
    sessionDismissals.clear()
    update(initial)
  }
}
export function finishInstallPrompt(prompt: InstallPrompt) {
  if (state.prompt === prompt) update({ ...state, finished: true, prompt: null })
}
