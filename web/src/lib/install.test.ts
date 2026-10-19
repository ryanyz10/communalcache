import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ReactElement, type ReactNode } from 'react'
import * as React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { AuthProvider } from '../auth/AuthProvider'
import { HomePage } from '../pages/HomePage'
import * as install from './install'

const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).reverse().forEach(stop => stop()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit Safari/604.1'
const android = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit Chrome/130.0 Mobile Safari/537.36'

function browser(userAgent = ios, platform = '', maxTouchPoints = 0) {
  const window = Object.assign(new EventTarget(), { matchMedia: () => media })
  const media = Object.assign(new EventTarget(), { matches: false, media: '(display-mode: standalone)' })
  const navigator = { userAgent, platform, maxTouchPoints, standalone: false }
  const values = new Map<string, string>()
  const localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const location = { origin: 'https://communalcache.com' }
  vi.stubGlobal('window', window); vi.stubGlobal('navigator', navigator)
  vi.stubGlobal('localStorage', localStorage); vi.stubGlobal('sessionStorage', { getItem: () => null }); vi.stubGlobal('location', location)
  return { window, media, navigator, values, localStorage, location }
}
function track() { cleanup.push(install.startInstallTracking()) }
function event(choice: Promise<{ outcome: 'accepted' | 'dismissed' }> = Promise.resolve({ outcome: 'dismissed' })) {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(async () => {}), userChoice: choice }) as install.InstallPrompt & { prompt: ReturnType<typeof vi.fn> }
}
function text(node: ReactNode): string { return React.Children.toArray(node).map(child => React.isValidElement(child) ? text((child as ReactElement<{ children: ReactNode }>).props.children) : String(child)).join('') }
function hint() {
  const states: unknown[] = [], refs: { current: unknown }[] = [], effects: (() => (() => void) | void)[] = []
  let index = 0, refIndex = 0, mounted = false, elements: ReactElement<Record<string, unknown>>[] = []
  const record = (factory: typeof jsx) => (...args: Parameters<typeof jsx>) => { const node = factory(...args) as ReactElement<Record<string, unknown>>; elements.push(node); return node }
  const modules: Record<string, unknown> = {
    react: { ...React,
      useState(initial: unknown) { const slot = index++; if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial; return [states[slot], (value: unknown) => { states[slot] = value }] },
      useRef(initial: unknown) { const slot = refIndex++; return refs[slot] ?? (refs[slot] = { current: initial }) },
      useEffect(effect: () => (() => void) | void) { if (!mounted) effects.push(effect) },
    },
    'react/jsx-runtime': { jsx: record(jsx), jsxs: record(jsxs) },
    '../lib/install': { ...install, useInstallState: install.installSnapshot }, '../install-hint.css': {},
  }
  const source = readFileSync(new URL('../components/InstallHint.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as { InstallHint: React.ComponentType } }
  new Function('require', 'module', 'exports', compiled)((name: string) => { if (!(name in modules)) throw new Error(name); return modules[name] }, module, module.exports)
  function render() {
    index = 0; refIndex = 0; elements = []
    const html = renderToStaticMarkup(createElement(module.exports.InstallHint))
    if (!mounted) { effects.forEach(effect => { const stop = effect(); if (stop) cleanup.push(stop) }); mounted = true }
    return html
  }
  render()
  return {
    render,
    click(label: string) { const button = elements.find(node => node.type === 'button' && text(node.props.children as ReactNode) === label)!; (button.props.onClick as () => void)(); return render() },
    async flush() { for (let count = 0; count < 10; count++) await Promise.resolve(); return render() },
  }
}

it.each([
  [ios, '', 0, 'ios'], [ios.replace('Safari/604.1', 'CriOS/130.0'), '', 0, 'ios'],
  ['Mozilla/5.0 (Macintosh) Safari/604.1', 'MacIntel', 5, 'ios'],
  [android, '', 0, 'android'], [android + ' EdgA/130.0', '', 0, 'android'], [android + ' SamsungBrowser/27.0', '', 0, 'android'],
  ['Mozilla/5.0 (Android 15) Gecko Firefox/130.0', '', 0, 'none'],
  [android + ' Instagram 300.0', '', 0, 'in-app'], [ios + ' FBAN/FBIOS;FBAV/500', '', 0, 'in-app'],
  [ios + ' Gmail/6.0', '', 0, 'in-app'], [android + ' LinkedInApp/4.0', '', 0, 'in-app'],
  ['Mozilla/5.0 (Linux; Android 15; wv) Chrome/130.0', '', 0, 'in-app'],
  ['Mozilla/5.0 (Windows NT 10.0) Chrome/130.0', 'Win32', 0, 'none'], ['Mozilla/5.0 (Macintosh) Safari/604.1', 'MacIntel', 0, 'none'],
] as const)('detects the install path for %s', (userAgent, platform, maxTouchPoints, expected) => {
  expect(install.installPlatform({ userAgent, platform, maxTouchPoints })).toBe(expected)
})

it('recognizes display-mode and legacy iOS standalone, and rechecks changes', () => {
  const b = browser(); track()
  expect(hint().render()).toContain(install.installCopy.heading)
  b.media.matches = true; b.media.dispatchEvent(new Event('change'))
  expect(install.installSnapshot().standalone).toBe(true)
  expect(hint().render()).toBe('')
  b.media.matches = false; b.navigator.standalone = true; b.media.dispatchEvent(new Event('change'))
  expect(install.standaloneMode()).toBe(true)
  expect(hint().render()).toBe('')
})

it('keeps legacy standalone detection safe when matchMedia is unavailable', () => {
  const b = browser()
  Object.assign(b.window, { matchMedia: undefined })
  b.navigator.standalone = true
  track()
  expect(install.installSnapshot().standalone).toBe(true)
  expect(hint().render()).toBe('')
})

it('shows iOS instructions/share icon without a programmatic install, and only webview guidance in-app', () => {
  const b = browser(); track()
  const html = hint().render()
  expect(html).toContain('aria-labelledby="install-hint-heading"')
  expect(html).toContain(install.installCopy.add)
  expect(html).toContain(install.installCopy.notifications)
  expect(html).toContain('aria-hidden="true" focusable="false"')
  expect(html).not.toContain('>Install</button>')
  const prompt = event(); b.window.dispatchEvent(prompt)
  expect(prompt.defaultPrevented).toBe(false)
  expect(prompt.prompt).not.toHaveBeenCalled()
  b.navigator.userAgent += ' Instagram'
  expect(hint().render()).toContain(install.installCopy.inApp)
  expect(hint().render()).not.toContain(install.installCopy.notifications)
})

it.each(['accepted', 'dismissed'] as const)('retains an early Android event, prompts only on click and hides after %s', async outcome => {
  const b = browser(android); track()
  expect(hint().render()).toBe('')
  let choose!: (value: { outcome: 'accepted' | 'dismissed' }) => void
  const prompt = event(new Promise(resolve => { choose = resolve }))
  b.window.dispatchEvent(prompt)
  expect(prompt.defaultPrevented).toBe(true)
  expect(prompt.prompt).not.toHaveBeenCalled()
  const ui = hint()
  expect(ui.render()).toContain('>Install</button>')
  ui.click(install.installCopy.install)
  expect(prompt.prompt).toHaveBeenCalledOnce()
  expect(ui.render()).toContain(install.installCopy.installing)
  choose({ outcome }); await ui.flush()
  expect(ui.render()).toBe('')
  const next = event(); b.window.dispatchEvent(next)
  expect(next.defaultPrevented).toBe(false)
})

it('hides a visible Android hint immediately after appinstalled', () => {
  const b = browser(android); track()
  b.window.dispatchEvent(event())
  const ui = hint()
  expect(ui.render()).toContain(install.installCopy.install)
  b.window.dispatchEvent(new Event('appinstalled'))
  expect(ui.render()).toBe('')
  expect(install.installSnapshot().prompt).toBeNull()
})

it('hides after appinstalled and discards a failed prompt without an unhandled rejection', async () => {
  const b = browser(android); track()
  const prompt = event(); prompt.prompt.mockRejectedValueOnce(new Error('Unavailable'))
  b.window.dispatchEvent(prompt)
  const ui = hint(); ui.click(install.installCopy.install); await ui.flush()
  expect(ui.render()).toBe('')
  b.window.dispatchEvent(new Event('appinstalled'))
  expect(install.installSnapshot().installed).toBe(true)
})

it('never captures a desktop or unsupported Android prompt', () => {
  const b = browser('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0'); track()
  const prompt = event(); b.window.dispatchEvent(prompt)
  expect(prompt.defaultPrevented).toBe(false)
  expect(hint().render()).toBe('')
  b.navigator.userAgent = 'Mozilla/5.0 (Android 15) Firefox/130.0'
  b.window.dispatchEvent(event())
  expect(hint().render()).toBe('')
})

it('stores Not now for exactly 30 days and never dismissal forever, scoped only by site', () => {
  const b = browser(), now = 1_000_000
  install.dismissInstallHint(false, now)
  const key = install.installHintKey(b.location.origin)
  expect([...b.values.keys()]).toEqual([key])
  expect(install.installHintDismissed(now + 30 * 86_400_000 - 1)).toBe(true)
  expect(install.installHintDismissed(now + 30 * 86_400_000)).toBe(false)
  install.dismissInstallHint(true, now)
  expect(b.values.get(key)).toBe('never')
  expect(install.installHintDismissed(now + 10 * 365 * 86_400_000)).toBe(true)
  b.location.origin = 'https://staging.example.test'
  expect(install.installHintDismissed(now)).toBe(false)
  for (const value of ['bad', 'Infinity', '-1']) { b.values.set(install.installHintKey(b.location.origin), value); expect(install.installHintDismissed(now)).toBe(false) }
})

it.each([false, true])('dismisses the visible iOS card with its accessible choice (forever=%s)', forever => {
  const b = browser(); track()
  const ui = hint()
  expect(ui.click(forever ? install.installCopy.never : install.installCopy.notNow)).toBe('')
  expect(install.installHintDismissed()).toBe(true)
  expect(b.values.get(install.installHintKey(b.location.origin))).toEqual(forever ? 'never' : expect.any(String))
})

it('keeps dismissal across Home remounts in this tab even when localStorage is blocked', () => {
  const b = browser(); track()
  vi.stubGlobal('localStorage', { getItem() { throw new Error('Blocked') }, setItem() { throw new Error('Blocked') } })
  const ui = hint()
  expect(ui.render()).toContain(install.installCopy.heading)
  ui.click(install.installCopy.notNow); b.window.dispatchEvent(new Event('focus'))
  expect(ui.render()).toBe('')
  expect(hint().render()).toBe('')
})

it('limits the Home card to signed-in named users and keeps the card static under reduced motion', () => {
  browser(); track()
  for (const user of [null, { id: 'owner', display_name: null }, { id: 'owner', display_name: 'Neighbor' }]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['me'], user)
    client.setQueryData(['caches'], [])
    client.setQueryData(['home-summary'], { owned_item_count: 0, pending_answer_count: 0, incoming: [], outgoing: [] })
    client.setQueryData(['library', user?.id], { pages: [{ items: [], next_cursor: null }], pageParams: [null] })
    const children = createElement(MemoryRouter, null, createElement(HomePage))
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children })))
    expect(html.includes(install.installCopy.heading)).toBe(!!user?.display_name)
    client.clear()
  }
  const css = readFileSync(new URL('../install-hint.css', import.meta.url), 'utf8')
  expect(css).toContain('var(--cc-card)')
  expect(css).toContain('min-height: 44px')
  expect(css).not.toMatch(/animation:|transition:/)
})
