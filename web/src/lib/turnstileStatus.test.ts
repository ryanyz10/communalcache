import { afterEach, expect, it, vi } from 'vitest'
import * as React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { mountTurnstile, type TurnstileApi } from './turnstile'
import type { TurnstileHandle, TurnstileStatus } from '../components/Turnstile'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture(action: 'signin' | 'create_cache' = 'signin', blocked = false) {
  const states: unknown[] = [], setters: ((value: unknown) => void)[] = [], refs: { current: unknown }[] = []
  const effects: { dependencies: unknown[]; cleanup?: () => void }[] = []
  const callbacks: { dependencies: unknown[]; value: unknown }[] = []
  let stateIndex = 0, refIndex = 0, effectIndex = 0, callbackIndex = 0
  let pendingEffects: (() => void)[] = []
  const config = { data: { turnstile_site_key: 'fixture' }, isPending: false, isError: false, isSuccess: true, isFetching: false, refetch: vi.fn() }
  const onToken = vi.fn(), onStatus = vi.fn<(status: TurnstileStatus) => void>()
  const provider = { render: vi.fn((_root: HTMLElement, _options: Parameters<TurnstileApi['render']>[1]) => `widget-${provider.render.mock.calls.length}`), reset: vi.fn(), remove: vi.fn() }
  const load = vi.fn(async () => { if (blocked) throw new Error('blocked'); return provider })
  const reload = vi.fn()
  vi.stubGlobal('location', { reload })
  vi.stubGlobal('matchMedia', () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const handle = { current: null as TurnstileHandle | null }
  const modules: Record<string, unknown> = {
    react: {
      ...React,
      useState(initial: unknown) {
        const index = stateIndex++
        if (!(index in states)) {
          states[index] = initial
          setters[index] = (value: unknown) => { states[index] = typeof value === 'function' ? value(states[index]) : value }
        }
        return [states[index], setters[index]]
      },
      useRef(initial: unknown) { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }) },
      useEffect(effect: () => (() => void) | void, dependencies: unknown[]) {
        const index = effectIndex++, previous = effects[index]
        if (previous && dependencies.every((value, slot) => Object.is(value, previous.dependencies[slot]))) return
        pendingEffects.push(() => {
          previous?.cleanup?.()
          effects[index] = { dependencies, cleanup: effect() ?? undefined }
        })
      },
      useImperativeHandle(ref: typeof handle, create: () => TurnstileHandle) { ref.current = create() },
      useCallback(value: unknown, dependencies: unknown[]) {
        const index = callbackIndex++, previous = callbacks[index]
        if (!previous || !dependencies.every((value, slot) => Object.is(value, previous.dependencies[slot]))) callbacks[index] = { value, dependencies }
        return callbacks[index].value
      },
    },
    'react/jsx-runtime': {
      jsx: (type: unknown, props: Record<string, unknown>, key: string) => { if (type === 'div' && props.ref) (props.ref as { current: unknown }).current = {}; return jsx(type as React.ElementType, props, key) },
      jsxs, Fragment: React.Fragment,
    },
    '@tanstack/react-query': { useQuery: () => config },
    '../lib/config': { loadConfig: vi.fn() },
    '../lib/turnstile': { loadTurnstile: load, mountTurnstile, turnstileTheme: () => 'light' },
    './Skeleton': { LoadingStatus: () => null, Shimmer: () => null },
  }
  const source = readFileSync(new URL('../components/Turnstile.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as { Turnstile: React.ComponentType<Record<string, unknown>> } }
  new Function('require', 'module', 'exports', compiled)((name: string) => { if (!(name in modules)) throw new Error(name); return modules[name] }, module, module.exports)
  function render() {
    stateIndex = 0; refIndex = 0; effectIndex = 0; callbackIndex = 0; pendingEffects = []
    const html = renderToStaticMarkup(React.createElement(module.exports.Turnstile, { action, onToken, onStatus, ref: handle }))
    pendingEffects.forEach(effect => effect())
    return html
  }
  async function flush() { for (let i = 0; i < 6; i++) { render(); await Promise.resolve() } return render() }
  render()
  return { config, provider, load, onToken, onStatus, reload, handle, render, flush,
    latest: () => provider.render.mock.calls.at(-1)![1],
    unmount() { effects.forEach(effect => effect.cleanup?.()) },
  }
}

it.each(['signin', 'create_cache'] as const)('%s silently remounts once, then reports failure and supports explicit retry and verification', async action => {
  const view = fixture(action); await view.flush()
  expect(view.latest()).toMatchObject({ action, appearance: 'interaction-only', retry: 'never' })
  expect(view.onStatus).toHaveBeenLastCalledWith('checking')
  const stale = view.latest()
  stale['error-callback'](); await view.flush()
  expect(view.provider.render).toHaveBeenCalledTimes(2)
  expect(view.onStatus).not.toHaveBeenCalledWith('failed')
  view.latest()['error-callback'](); const failed = await view.flush()
  expect(view.onStatus).toHaveBeenLastCalledWith('failed')
  expect(view.provider.render).toHaveBeenCalledTimes(2)
  expect(failed).not.toContain('Retry bot check')
  expect(failed).not.toContain('Checking your browser')
  expect(failed).toContain('aria-label="Bot protection"')
  view.handle.current!.retry(); await view.flush()
  expect(view.provider.render).toHaveBeenCalledTimes(3)
  expect(view.onStatus).toHaveBeenLastCalledWith('checking')
  view.latest().callback('fresh-token'); await view.flush()
  expect(view.onStatus).toHaveBeenLastCalledWith('verified')
  expect(view.onToken).toHaveBeenLastCalledWith('fresh-token')
  stale.callback('stale-token'); expect(view.onToken).toHaveBeenLastCalledWith('fresh-token')
  view.handle.current!.reset(); await view.flush()
  expect(view.provider.reset).toHaveBeenCalled()
  expect(view.onToken).toHaveBeenLastCalledWith('')
  expect(view.onStatus).toHaveBeenLastCalledWith('checking')
  view.unmount()
})

it('bounds blocked-script retries and keeps config refetch/reload recovery', async () => {
  const view = fixture('signin', true)
  await view.flush()
  expect(view.load).toHaveBeenCalledTimes(2)
  expect(view.onStatus).toHaveBeenLastCalledWith('failed')
  view.unmount()
  const config = fixture()
  config.config.data.turnstile_site_key = ''
  await config.flush()
  expect(config.config.refetch).toHaveBeenCalledOnce()
  config.config.isFetching = true; await config.flush()
  expect(config.onStatus).toHaveBeenLastCalledWith('checking')
  config.config.isFetching = false; await config.flush()
  expect(config.onStatus).toHaveBeenLastCalledWith('failed')
  config.handle.current!.retry(); expect(config.reload).toHaveBeenCalledOnce()
  config.config.isError = true; config.config.isSuccess = false; config.render()
  config.config.refetch.mockClear()
  config.handle.current!.retry(); expect(config.config.refetch).toHaveBeenCalledOnce()
  config.unmount()
})
