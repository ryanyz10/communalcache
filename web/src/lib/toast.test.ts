import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { Toast, type ToastProvider, type useToast } from '../components/Toast'
import { ApiError } from './api'
import { transientActionFailure } from './feedback'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function toastHost() {
  let value: unknown = null, dependency: unknown = Symbol('unset')
  let effect: (() => void) | undefined, cleanup: (() => void) | undefined
  const sequence = { current: 0 }
  const source = readFileSync(new URL('../components/Toast.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const context = { Provider: Symbol('provider'), current: {} as ReturnType<typeof useToast> }
  const jsx = (type: unknown, props: Record<string, unknown>) => { if (type === context.Provider) context.current = props.value as ReturnType<typeof useToast>; return { type, props } }
  const module = { exports: {} as { useToast: typeof useToast; ToastProvider: typeof ToastProvider } }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === 'react-dom') return { createPortal: (node: unknown) => node }
    if (name !== 'react') throw new Error(`Unexpected dependency ${name}`)
    return {
      createContext: (initial: ReturnType<typeof useToast>) => { context.current = initial; return context },
      useContext: () => context.current,
      useCallback: (callback: unknown) => callback,
      useRef: () => sequence,
      useState: () => [value, (next: unknown) => { value = typeof next === 'function' ? next(value) : next }],
      useEffect: (next: () => (() => void) | undefined, deps: unknown[]) => {
        if (dependency !== deps[0]) { dependency = deps[0]; effect = () => { cleanup?.(); cleanup = next() } }
      },
    }
  }, module, module.exports)
  function render() {
    module.exports.ToastProvider({ children: null })
    effect?.(); effect = undefined
    return module.exports.useToast()
  }
  render()
  return {
    current: render,
    show(message: string, tone: 'success' | 'error' = 'success') { render().showToast(message, tone); return render() },
    dismiss() { render().dismissToast(); render() },
    unmount() { cleanup?.() },
  }
}

it('dismisses success at 2500ms and error at 5000ms, with no idle timer', () => {
  vi.useFakeTimers()
  const host = toastHost()
  expect(host.current().toast).toBeNull(); expect(vi.getTimerCount()).toBe(0)
  host.show('Saved.')
  vi.advanceTimersByTime(2499); expect(host.current().toast?.message).toBe('Saved.')
  vi.advanceTimersByTime(1); expect(host.current().toast).toBeNull()
  host.show('Could not save.', 'error')
  vi.advanceTimersByTime(4999); expect(host.current().toast?.tone).toBe('error')
  vi.advanceTimersByTime(1); expect(host.current().toast).toBeNull()
})

it('shares one replaceable notice across consumers and refreshes repeated announcements', () => {
  vi.useFakeTimers()
  const host = toastHost(), first = host.current(), second = host.current()
  first.showToast('Copied.'); const initial = host.current().toast
  vi.advanceTimersByTime(2000)
  second.showToast('Could not save.', 'error'); host.current()
  expect(host.current().toast).toMatchObject({ message: 'Could not save.', tone: 'error', sequence: initial!.sequence + 1 })
  vi.advanceTimersByTime(1000); expect(host.current().toast?.tone).toBe('error')
  const repeated = host.show('Could not save.', 'error').toast
  expect(repeated!.sequence).toBe(initial!.sequence + 2)
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(4999); expect(host.current().toast).not.toBeNull()
  vi.advanceTimersByTime(1); expect(host.current().toast).toBeNull()
})

it('cleans timers on dismissal/unmount and never reuses an announcement sequence', () => {
  vi.useFakeTimers()
  const host = toastHost(), first = host.show('Saved.').toast
  host.dismiss(); expect(host.current().toast).toBeNull(); expect(vi.getTimerCount()).toBe(0)
  expect(host.show('Saved.').toast!.sequence).toBeGreaterThan(first!.sequence)
  host.unmount(); expect(vi.getTimerCount()).toBe(0)
})

it('uses polite status for success, assertive alert for errors and escapes text without taking focus', () => {
  expect(renderToStaticMarkup(createElement(Toast, { toast: null }))).toBe('<div class="cc-toast-region" role="status" aria-live="polite" aria-atomic="true"></div>')
  for (const tone of ['success', 'error'] as const) {
    const html = renderToStaticMarkup(createElement(Toast, { toast: { message: '<b>Notice</b>', sequence: 1, tone } }))
    expect(html).toContain(tone === 'error' ? 'role="alert" aria-live="assertive"' : 'role="status" aria-live="polite"')
    expect(html).toContain('&lt;b&gt;Notice&lt;/b&gt;')
    expect(html).not.toMatch(/tabindex|autofocus|<button/)
  }
  vi.stubGlobal('HTMLElement', { prototype: { showPopover() {} } })
  expect(renderToStaticMarkup(createElement(Toast, { toast: null }))).toContain('popover="manual"')
})

it('keeps the shared host outside route/session children with safe-area and reduced-motion styling', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
  expect(app).toContain('<ToastProvider><Ready>')
  const source = readFileSync(new URL('../components/Toast.tsx', import.meta.url), 'utf8')
  expect(source).toContain("document.querySelector<HTMLElement>('dialog[open]') ?? document.body")
  expect(source).toContain('new MutationObserver(move)')
  expect(source).toContain('createPortal(notice, target)')
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  const region = css.match(/\.cc-toast-region\s*\{([^}]+)\}/)![1]
  for (const fragment of ['position: fixed', 'left: 50%', 'env(safe-area-inset-top,0px)', 'env(safe-area-inset-left,0px)', 'pointer-events: none']) expect(region).toContain(fragment)
  const message = css.match(/\.cc-toast-message\s*\{([^}]+)\}/)![1]
  for (const token of ['--cc-fg', '--cc-bg', '--cc-shadow', '--radius-pill']) expect(message).toContain(`var(${token})`)
  expect(css).toContain('.cc-toast-error')
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.cc-toast-message\s*\{\s*animation: none;/)
})

it('moves known operational failures while retaining validation, limits, state and uncertain errors', () => {
  for (const error of [new TypeError('Network'), new SyntaxError('Reply'), new ApiError(503, 'internal_error'), new ApiError(502, 'email_unavailable')]) expect(transientActionFailure(error)).toBe(true)
  for (const error of [new Error('Unknown'), new ApiError(400, 'invalid_name'), new ApiError(409, 'limit_reached'), new ApiError(503, 'limits_unavailable'), new ApiError(429, 'rate_limited'), new ApiError(404, 'not_found'), new ApiError(409, 'request_not_pending')]) expect(transientActionFailure(error)).toBe(false)
})
