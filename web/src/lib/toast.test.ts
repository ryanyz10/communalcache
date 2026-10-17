import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { Toast, type useToast } from '../components/Toast'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function toastHook() {
  let value: unknown = null
  let effect: (() => void) | undefined, cleanup: (() => void) | undefined, dependency: unknown
  const source = readFileSync(new URL('../components/Toast.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as { useToast: typeof useToast } }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (name === 'react/jsx-runtime') return {}
    if (name !== 'react') throw new Error(`Unexpected dependency ${name}`)
    return {
      useState: () => [value, (next: unknown) => { value = typeof next === 'function' ? next(value) : next }],
      useEffect: (next: () => (() => void) | undefined, deps: unknown[]) => {
        if (dependency !== deps[0]) { dependency = deps[0]; effect = () => { cleanup?.(); cleanup = next() } }
      },
    }
  }, module, module.exports)
  function render() {
    const state = module.exports.useToast()
    effect?.(); effect = undefined
    return state
  }
  render()
  return {
    current: render,
    show(message: string) { render().showToast(message); return render() },
    dismiss() { render().dismissToast(); render() },
    unmount() { cleanup?.() },
  }
}

it('auto-dismisses the message at 2500ms, with no timer while idle', () => {
  vi.useFakeTimers()
  const hook = toastHook()
  expect(hook.current().toast).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  hook.show('Invite copied.')
  vi.advanceTimersByTime(2499)
  expect(hook.current().toast?.message).toBe('Invite copied.')
  vi.advanceTimersByTime(1)
  expect(hook.current().toast).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})

it('re-copying the same message restarts the timer and refreshes its announcement key', () => {
  vi.useFakeTimers()
  const hook = toastHook(), first = hook.show('Invite copied.').toast
  vi.advanceTimersByTime(2000)
  const repeated = hook.show('Invite copied.').toast
  expect(repeated?.sequence).toBe(first!.sequence + 1)
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(2499)
  expect(hook.current().toast?.message).toBe('Invite copied.')
  vi.advanceTimersByTime(1)
  expect(hook.current().toast).toBeNull()
})

it('cleans timers on explicit dismissal and unmount, including error feedback', () => {
  vi.useFakeTimers()
  const hook = toastHook()
  hook.show('Could not copy. Select the invite link.')
  hook.dismiss()
  expect(hook.current().toast).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  hook.show('Invite copied.')
  hook.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('keeps a persistent polite status region and escapes success/error text without taking focus', () => {
  expect(renderToStaticMarkup(createElement(Toast, { toast: null }))).toBe('<div class="cc-toast-region" role="status" aria-live="polite" aria-atomic="true"></div>')
  const html = renderToStaticMarkup(createElement(Toast, { toast: { message: '<b>Could not copy</b>', sequence: 1 } }))
  expect(html).toContain('&lt;b&gt;Could not copy&lt;/b&gt;')
  expect(html).not.toMatch(/tabindex|autofocus|<button/)
})

it('uses fixed safe-area-aware top positioning, cozy theme tokens and a static reduced-motion variant', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  const region = css.match(/\.cc-toast-region\s*\{([^}]+)\}/)![1]
  expect(region).toContain('position: fixed')
  expect(region).toContain('left: 50%')
  expect(region).toContain('env(safe-area-inset-top,0px)')
  expect(region).toContain('env(safe-area-inset-left,0px)')
  expect(region).toContain('pointer-events: none')
  const message = css.match(/\.cc-toast-message\s*\{([^}]+)\}/)![1]
  for (const token of ['--cc-fg', '--cc-bg', '--cc-shadow', '--radius-pill']) expect(message).toContain(`var(${token})`)
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.cc-toast-message\s*\{\s*animation: none;/)
})
