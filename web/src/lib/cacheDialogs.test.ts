import { afterEach, expect, it, vi } from 'vitest'
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import * as React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import * as Router from 'react-router'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { apiFetch, errorMessage } from './api'
import { cacheDetailQuery, type CacheDetail } from './caches'
import { invalidateRequestViews } from './requests'

type Flow = 'rotate' | 'remove' | 'leave'
type Element = ReactElement<Record<string, unknown>>
type MutationOptions = {
  mutationFn: (variables?: unknown) => Promise<unknown>
  onSuccess?: (data: unknown, variables?: unknown) => unknown
}
const cacheId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'
const memberId = '33333333-3333-4333-8333-333333333333'
const cache: CacheDetail = {
  id: cacheId, name: 'Tools', owner_id: ownerId, requires_approval: true,
  invite_token: `${cacheId}.${'A'.repeat(43)}`,
  members: [
    { user_id: ownerId, display_name: 'Owner', attached_item_count: 0 },
    { user_id: memberId, display_name: 'Member', attached_item_count: 0 },
  ],
}
const parent = '842f85f73b442da878c21f4daa62d806fa6631ec'
const source = process.env.CACHE_DIALOG_PARENT === '1'
  ? execFileSync('git', ['show', `${parent}:web/src/pages/CacheSettingsPage.tsx`], { encoding: 'utf8' })
  : readFileSync(new URL('../pages/CacheSettingsPage.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function descendants(children: ReactNode): Element[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement(child)) return []
    const node = child as Element
    return [node, ...descendants(node.props.children as ReactNode)]
  })
}
function text(node: Element): string {
  return Children.toArray(node.props.children as ReactNode).map(child =>
    isValidElement(child) ? text(child as Element) : String(child),
  ).join('')
}

function fixture(flow: Flow) {
  const trace: unknown[][] = []
  const states: unknown[] = []
  const refs: { current: unknown }[] = []
  const mutations: { options: MutationOptions; pending: boolean; error: unknown; success: boolean; api: object }[] = []
  let elements: Element[] = []
  let stateIndex = 0, refIndex = 0, mutationIndex = 0
  let lastMutation: Promise<void> = Promise.resolve()
  let active = { id: '', label: '' }
  let releaseInvalidations!: () => void
  const invalidations = new Promise<void>(resolve => { releaseInvalidations = resolve })
  const label = flow === 'rotate' ? 'rotate-heading' : flow === 'remove' ? `remove-${memberId}` : 'leave-cache-heading'
  const dialogModel = {
    open: false,
    showModal() {
      this.open = true
      const autofocus = buttons().find(button => button.props.autoFocus)
      active = { id: '', label: autofocus ? text(autofocus) : '' }
      trace.push(['open', label], ['focus', active.label])
    },
    close() { this.open = false; trace.push(['close', label]) },
  }
  const queryClient = {
    invalidateQueries: vi.fn(({ queryKey }: { queryKey: unknown[] }) => {
      trace.push(['invalidate', queryKey]); return invalidations
    }),
    removeQueries: vi.fn(({ queryKey }: { queryKey: unknown[] }) => { trace.push(['remove', queryKey]) }),
  }
  const useMutation = (options: MutationOptions) => {
    const index = mutationIndex++
    if (!mutations[index]) {
      const entry = { options, pending: false, error: null as unknown, success: false, api: {} }
      entry.api = {
        get isPending() { return entry.pending },
        get isError() { return !!entry.error },
        get isSuccess() { return entry.success },
        get error() { return entry.error },
        reset() { entry.pending = false; entry.error = null; entry.success = false },
        mutate(variables?: unknown) {
          entry.pending = true; entry.error = null; entry.success = false
          lastMutation = (async () => {
            try {
              const data = await entry.options.mutationFn(variables)
              await entry.options.onSuccess?.(data, variables)
              entry.success = true
            } catch (error) { entry.error = error }
            finally { entry.pending = false }
          })()
        },
      }
      mutations[index] = entry
    }
    mutations[index].options = options
    return mutations[index].api
  }
  const record = (factory: typeof jsx) => (...args: Parameters<typeof jsx>) => {
    const element = factory(...args)
    if (typeof element.type === 'string') elements.push(element as Element)
    return element
  }
  const modules: Record<string, unknown> = {
    react: {
      ...React,
      useState(initial: unknown) {
        const index = stateIndex++
        if (!(index in states)) states[index] = initial
        return [states[index], (value: unknown) => { states[index] = value; trace.push(['state', value]) }]
      },
      useRef(initial: unknown) {
        const index = refIndex++
        return refs[index] ?? (refs[index] = { current: initial })
      },
    },
    'react/jsx-runtime': { jsx: record(jsx), jsxs: record(jsxs), Fragment: React.Fragment },
    'react-router': { ...Router, useParams: () => ({ cacheId }), useNavigate: () => (path: string) => trace.push(['navigate', path]) },
    '@tanstack/react-query': { useQuery: () => ({ data: cache, isPending: false, isError: false }), useQueryClient: () => queryClient, useMutation },
    '../auth/AuthProvider': { useAuth: () => ({ me: { id: flow === 'leave' ? memberId : ownerId, display_name: 'Neighbor' } }) },
    '../lib/api': { apiFetch, errorMessage },
    '../lib/caches': { cacheDetailQuery },
    '../lib/requests': { invalidateRequestViews },
    './OnboardingPage': { OnboardingPage: () => null },
    './JoinRequests': { JoinRequests: () => null },
    '../components/WideBreadcrumbs': { WideBreadcrumbs: ({ children }: { children: ReactNode }) => createElement('nav', null, children) },
    '../components/Avatar': { Avatar: () => null },
    '../components/Toast': { Toast: () => null, useToast: () => ({ toast: null, showToast: vi.fn(), dismissToast: () => trace.push(['dismiss-toast']) }) },
    '../components/skeletons/CacheSkeleton': { CacheSettingsSkeleton: () => null },
  }
  const module = { exports: {} as { CacheSettingsPage: () => ReactElement } }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected settings dependency: ${name}`)
    return modules[name]
  }, module, module.exports)
  vi.stubGlobal('location', { origin: 'https://communalcache.com' })
  vi.stubGlobal('document', { getElementById: (id: string) => ({ focus() { active = { id, label: '' }; trace.push(['focus', id]) } }) })
  function dialog() { return elements.find(element => element.type === 'dialog' && element.props['aria-labelledby'] === label)! }
  function buttons() { return descendants(dialog().props.children as ReactNode).filter(element => element.type === 'button') }
  function render() {
    elements = []; stateIndex = 0; refIndex = 0; mutationIndex = 0
    const html = renderToStaticMarkup(createElement(Router.MemoryRouter, null, createElement(module.exports.CacheSettingsPage)))
    ;(dialog().props.ref as { current: unknown }).current = dialogModel
    return html
  }
  function open() {
    const trigger = elements.find(element => element.type === 'button' && (
      flow === 'rotate' ? text(element).startsWith('Reset link')
        : flow === 'remove' ? element.props['aria-label'] === 'Remove Member' : text(element) === 'Leave cache'
    ))!
    ;(trigger.props.onClick as () => void)()
  }
  function escape() {
    const preventDefault = vi.fn()
    ;(dialog().props.onCancel as (event: { preventDefault: () => void }) => void)({ preventDefault })
    if (!preventDefault.mock.calls.length) dialogModel.close()
    return preventDefault
  }
  render()
  return {
    trace, queryClient, dialogModel, render, open, escape, releaseInvalidations,
    buttons, active: () => active, settled: () => lastMutation,
    cancel: () => (buttons()[0].props.onClick as () => void)(),
    confirm: () => (buttons()[1].props.onClick as () => void)(),
  }
}

const requestInvalidations = ['item-requests', 'requests', 'item', 'items', 'library', 'library-item', 'home-summary', 'caches', 'cache', 'request-detail', 'request-contact']

for (const flow of ['rotate', 'remove', 'leave'] as const) {
  it(`${flow} declares safe initial Cancel focus and cancels/Escapes without a request`, () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const page = fixture(flow)
    page.open()
    expect(page.buttons()[0].props.autoFocus).toBe(true)
    expect(page.active().label).toBe('Cancel')
    page.cancel()
    expect(page.dialogModel.open).toBe(false)
    page.open()
    expect(page.escape()).not.toHaveBeenCalled()
    expect(page.dialogModel.open).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(page.queryClient.invalidateQueries).not.toHaveBeenCalled()
  })

  it(`${flow} sends the parent method/URL/body, blocks pending Escape, and retains errors`, async () => {
    let respond!: (response: Response) => void
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { respond = resolve }))
    const page = fixture(flow)
    page.open(); page.confirm(); page.render()
    expect(page.buttons().every(button => button.props.disabled)).toBe(true)
    expect(page.escape()).toHaveBeenCalledOnce()
    expect(page.dialogModel.open).toBe(true)
    const suffix = flow === 'rotate' ? '/invite/rotate' : flow === 'remove' ? `/members/${memberId}` : '/leave'
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/caches/${cacheId}${suffix}`, expect.objectContaining({
      method: flow === 'remove' ? 'DELETE' : 'POST',
      credentials: 'same-origin',
      body: flow === 'remove' ? undefined : '{}',
    }))
    respond(Response.json({ error: 'internal_error' }, { status: 503 }))
    await page.settled()
    expect(page.render()).toContain('Could not complete that request. Please try again.')
    expect(page.dialogModel.open).toBe(true)
    expect(page.buttons().every(button => !button.props.disabled)).toBe(true)
    expect(page.queryClient.invalidateQueries).not.toHaveBeenCalled()
    page.cancel()
    expect(page.dialogModel.open).toBe(false)
  })

  it(`${flow} preserves close/invalidation/navigation/focus order and awaits invalidation`, async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => flow === 'rotate' ? Response.json(cache) : new Response(null, { status: 204 }))
    const page = fixture(flow)
    page.open(); page.trace.length = 0; page.confirm()
    await vi.waitFor(() => expect(page.queryClient.invalidateQueries).toHaveBeenCalled())
    expect(page.dialogModel.open).toBe(false)
    expect(page.trace.some(row => row[0] === 'navigate' || row[0] === 'focus')).toBe(false)
    page.releaseInvalidations()
    await page.settled()
    const label = flow === 'rotate' ? 'rotate-heading' : flow === 'remove' ? `remove-${memberId}` : 'leave-cache-heading'
    const expected: unknown[][] = [['close', label]]
    if (flow === 'rotate') {
      expected.push(['dismiss-toast'], ['state', 'Invite rotated. The old link no longer works.'], ['invalidate', ['cache', cacheId]])
      expect(page.render()).toContain('Invite rotated. The old link no longer works.')
    } else {
      if (flow === 'leave') expected.push(['remove', ['cache', cacheId]], ['remove', ['join-requests', cacheId]])
      else expected.push(['invalidate', ['cache', cacheId]])
      expected.push(['invalidate', ['caches']], ...requestInvalidations.map(key => ['invalidate', [key]]))
      expected.push(flow === 'leave' ? ['navigate', '/'] : ['focus', 'members-heading'])
    }
    expect(page.trace).toEqual(expected)
  })
}
