import { afterEach, expect, it, vi } from 'vitest'
import * as React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { Spotlight } from '../components/ProductTour'
import { Tabs } from '../components/Tabs'
import { MemoryRouter } from 'react-router'
import { saveTourCompletion, shouldStartTour, spotlightLayout, tourSteps } from './tour'
import type { Me } from './api'
import { meKey } from './profile'

type Element = React.ReactElement<Record<string, unknown>>
const initialMe: Me = { id: 'a', email: 'own@example.test', display_name: 'Neighbor', tour_completed_at: null }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture(initial: Me | null = initialMe, path = '/', deferNavigation = false) {
  const auth = { ready: true, me: initial }
  let pathname = path, dirty = false, stateIndex = 0, refIndex = 0, effectIndex = 0
  const states: unknown[] = [], refs: { current: unknown }[] = []
  const effects: { deps: unknown[]; cleanup?: () => void }[] = []
  let queued: (() => void)[] = [], tree: Element
  const client = {
    getQueryData: () => auth.me,
    setQueryData: (_key: unknown, update: (me: Me | null) => Me | null) => { auth.me = update(auth.me); dirty = true },
  }
  const routes: string[] = []
  const modules: Record<string, unknown> = {
    react: {
      ...React,
      useState(initial: unknown) {
        const index = stateIndex++
        if (!(index in states)) states[index] = initial
        return [states[index], (value: unknown) => {
          const next = typeof value === 'function' ? value(states[index]) : value
          if (!Object.is(next, states[index])) { states[index] = next; dirty = true }
        }]
      },
      useRef(initial: unknown) { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }) },
      useEffect(effect: () => (() => void) | void, deps: unknown[]) {
        const index = effectIndex++, previous = effects[index]
        if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
        queued.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: effect() ?? undefined } })
      },
      useLayoutEffect: () => {},
    },
    'react/jsx-runtime': { jsx, jsxs },
    'react-router': { useLocation: () => ({ pathname }), useNavigate: () => (to: string) => { if (!deferNavigation) pathname = to; routes.push(to); dirty = true } },
    '@tanstack/react-query': { useQueryClient: () => client },
    '../auth/AuthProvider': { useAuth: () => auth },
    '../lib/pendingJoin': { peekJoinToken: () => null },
    '../lib/tour': { saveTourCompletion, shouldStartTour, spotlightLayout, tourSteps },
    '../lib/profile': { meKey },
  }
  const source = readFileSync(new URL('../components/ProductTour.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as { ProductTourProvider: (props: { children: null }) => Element; Spotlight: (props: unknown) => Element } }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected tour dependency ${name}`)
    return modules[name]
  }, module, module.exports)
  function render() {
    let count = 0
    do {
      if (++count > 12) throw new Error('Tour render loop')
      dirty = false; stateIndex = 0; refIndex = 0; effectIndex = 0; queued = []
      tree = module.exports.ProductTourProvider({ children: null })
      queued.forEach(effect => effect())
    } while (dirty)
  }
  function active() { return (tree.props.children as unknown[])[1] as Element | null }
  function action(name: 'onBack' | 'onNext' | 'onSkip') { (active()!.props[name] as () => void)(); render() }
  function replay() { (tree.props.value as () => void)(); render() }
  function dialog() {
    stateIndex = states.length; refIndex = refs.length
    return module.exports.Spotlight(active()!.props)
  }
  render()
  return {
    auth, routes, render, active, action, replay, dialog,
    route(to: string) { pathname = to; render() },
    cancel() {
      const node = dialog()
      const preventDefault = vi.fn()
      ;(node.props.onCancel as (event: unknown) => void)({ preventDefault })
      render()
      return preventDefault
    },
  }
}

it('starts only for a ready named unseen account on Home, never during invite/deep-link or old-API resolution', () => {
  expect(shouldStartTour(true, initialMe, '/', false)).toBe(true)
  for (const [ready, me, path, invite] of [
    [false, initialMe, '/', false], [true, null, '/', false],
    [true, { ...initialMe, display_name: null }, '/', false],
    [true, { ...initialMe, tour_completed_at: 123 }, '/', false],
    [true, { ...initialMe, tour_completed_at: undefined }, '/', false],
    [true, initialMe, '/items', false], [true, initialMe, '/join/token', false], [true, initialMe, '/', true],
  ] as const) expect(shouldStartTour(ready, me, path, invite)).toBe(false)
  const page = fixture({ ...initialMe, display_name: null })
  expect(page.active()).toBeFalsy()
  page.auth.me = initialMe; page.render()
  expect(page.active()?.props.step).toBe(0)
})

it('visits all four real routes, navigates Back, and finishes optimistically without waiting for the write', async () => {
  let respond!: (response: Response) => void
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { respond = resolve }))
  const page = fixture()
  page.action('onNext'); expect(page.active()?.props.step).toBe(1)
  page.action('onBack'); expect(page.active()?.props.step).toBe(0)
  page.action('onNext'); page.action('onNext'); page.action('onNext')
  expect(page.active()?.props.step).toBe(3)
  page.action('onNext')
  expect(page.active()).toBeFalsy()
  expect(page.auth.me?.tour_completed_at).toEqual(expect.any(Number))
  expect(page.routes).toEqual(['/items', '/', '/items', '/requests', '/account'])
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  expect(fetch.mock.calls[0]).toEqual(['/api/me', expect.objectContaining({ method: 'PATCH', body: '{"tour_completed":true}', credentials: 'same-origin' })])
  respond(Response.json({})); await Promise.resolve()
})

it('keeps the modal mounted across deferred router commits and closes on unrelated browser navigation', () => {
  const page = fixture(initialMe, '/', true)
  page.action('onNext')
  expect(page.active()?.props.step).toBe(1)
  expect(page.active()?.props.pathname).toBe('/')
  page.action('onNext')
  expect(page.routes).toEqual(['/items'])
  page.route('/items')
  expect(page.active()?.props.step).toBe(1)
  page.route('/')
  expect(page.active()).toBeFalsy()
})

it('Skip and Escape both mark seen, stay closed through a stale refetch, and retry failure only once silently', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
  const page = fixture()
  expect(page.cancel()).toHaveBeenCalledOnce()
  expect(page.active()).toBeFalsy()
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  page.auth.me = initialMe; page.render()
  expect(page.active()).toBeFalsy()
  const second = fixture({ ...initialMe, id: 'b' })
  second.action('onSkip'); expect(second.active()).toBeFalsy()
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
})

it('Account Replay clears completion and starts at Home; serialized writes retain the latest finish/replay intent', async () => {
  let respond!: (response: Response) => void
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({})).mockImplementationOnce(() => new Promise(resolve => { respond = resolve }))
  const page = fixture({ ...initialMe, tour_completed_at: 123 }, '/account')
  expect(page.active()).toBeFalsy()
  page.replay()
  expect(page.auth.me?.tour_completed_at).toBeNull()
  expect(page.active()?.props.step).toBe(0)
  expect(page.routes).toEqual(['/'])
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  page.action('onSkip'); page.replay()
  expect(fetch).toHaveBeenCalledOnce()
  respond(Response.json({}))
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
  expect(fetch.mock.calls.map(call => JSON.parse(call[1]!.body as string).tour_completed)).toEqual([false, true, false])
})

it('hides the old tour immediately and never retries or updates a different signed-in account', async () => {
  let reject!: (error: Error) => void
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise }))
  const page = fixture()
  page.action('onSkip')
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  page.auth.ready = false; page.auth.me = null; page.render()
  expect(page.active()).toBeFalsy()
  const signal = fetch.mock.calls[0][1]!.signal!
  expect(signal.aborted).toBe(true)
  page.auth.ready = true; page.auth.me = { ...initialMe, id: 'b', tour_completed_at: 123 }; page.render()
  reject(new Error('old request aborted'))
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(fetch).toHaveBeenCalledOnce()
  expect(page.auth.me.tour_completed_at).toBe(123)
  page.auth.me = { ...initialMe, id: 'c' }; page.render()
  expect(page.active()?.props.step).toBe(0)
})

it('uses a labeled modal, live progress and keyboard-operable actions; first Back is disabled and the last step finishes', () => {
  const props = { onBack: () => {}, onNext: () => {}, onSkip: () => {} }
  const first = renderToStaticMarkup(React.createElement(Spotlight, { ...props, step: 0 }))
  expect(first).toContain('role="dialog" aria-modal="true"')
  expect(first).toContain('aria-labelledby="tour-heading" aria-describedby="tour-description tour-progress"')
  expect(first).toContain('aria-live="polite" aria-atomic="true">Step 1 of 4')
  expect(first).toContain('disabled="">Back')
  expect(first).toContain('cc-tour-centered')
  expect(renderToStaticMarkup(React.createElement(Spotlight, { ...props, step: 3 }))).toContain('>Finish</button>')
  const css = readFileSync(new URL('../tour.css', import.meta.url), 'utf8')
  expect(css).toContain('prefers-reduced-motion: reduce')
  expect(css).toContain('safe-area-inset-bottom')
  expect(css).toContain('var(--cc-card)')
})

it('cycles Tab and Shift+Tab between the modal actions rather than the page or browser chrome', () => {
  const page = fixture(), node = page.dialog()
  const first = { focus: vi.fn() }, last = { focus: vi.fn() }
  const preventDefault = vi.fn()
  const keydown = node.props.onKeyDown as (event: unknown) => void
  const currentTarget = { querySelectorAll: () => [first, last] }
  vi.stubGlobal('document', { activeElement: first })
  keydown({ key: 'Tab', shiftKey: true, currentTarget, preventDefault })
  expect(last.focus).toHaveBeenCalledOnce()
  vi.stubGlobal('document', { activeElement: last })
  keydown({ key: 'Tab', shiftKey: false, currentTarget, preventDefault })
  expect(first.focus).toHaveBeenCalledOnce()
  expect(preventDefault).toHaveBeenCalledTimes(2)
  keydown({ key: 'ArrowRight', currentTarget, preventDefault })
  expect(preventDefault).toHaveBeenCalledTimes(2)
})

it('marks real responsive navigation targets without adding fake controls', () => {
  for (const mobile of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Tabs, { mobile, count: 0 })))
    expect(html).toContain('data-tour="items"')
    expect(html).toContain('data-tour="requests"')
    expect(html).toContain('href="/items"')
    expect(html).toContain('href="/requests"')
    if (mobile) expect(html).toContain('data-tour="account"')
  }
  expect(readFileSync(new URL('../components/AppHeader.tsx', import.meta.url), 'utf8')).toContain('to="/account" data-tour="account"')
  expect(readFileSync(new URL('../pages/HomePage.tsx', import.meta.url), 'utf8')).toContain('className="cc-home-title" data-tour="caches"')
})

it('centers a missing/offscreen target and positions phone bottom-tab and desktop header spotlights within safe bounds', () => {
  const missing = spotlightLayout(null, 390, 780, 240)
  expect(missing.hole).toBeNull()
  expect(missing.card).toEqual({ left: 16, top: 270, width: 358 })
  expect(spotlightLayout({ left: 0, right: 40, top: 900, bottom: 940 }, 390, 780, 240).hole).toBeNull()
  const phone = spotlightLayout({ left: 280, right: 360, top: 680, bottom: 724 }, 390, 780, 240, { top: 44, right: 0, bottom: 34, left: 0 })
  expect(phone.card.top + 240).toBeLessThan(phone.hole!.top)
  expect(phone.card.left + phone.card.width).toBeLessThanOrEqual(374)
  const desktop = spotlightLayout({ left: 400, right: 530, top: 20, bottom: 56 }, 1440, 900, 240)
  expect(desktop.card.top).toBeGreaterThan(desktop.hole!.bottom)
  expect(desktop.card.left).toBe(394)
})
