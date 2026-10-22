import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ReactElement } from 'react'
import * as React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import * as Router from 'react-router'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { Toast, type useToast } from '../components/Toast'
import * as caches from './caches'
import * as joining from './joining'
import { apiFetch, errorMessage } from './api'
import { shareInvite } from './invites'
import { transientActionFailure } from './feedback'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function page(name: 'CachePage' | 'CacheSettingsPage') {
  const cacheId = '11111111-1111-4111-8111-111111111111'
  const cache = { id: cacheId, name: 'Tools', owner_id: 'owner', requires_approval: false, invite_token: `${cacheId}.${'A'.repeat(43)}`, members: [{ user_id: 'owner', display_name: 'Owner', attached_item_count: 0 }] }
  const elements: ReactElement<Record<string, unknown>>[] = []
  let notice: ReturnType<typeof useToast>['toast'] = null
  const showToast = vi.fn((message: string, tone: 'success' | 'error' = 'success') => { notice = { message, tone, sequence: (notice?.sequence ?? 0) + 1 } })
  const record = (factory: typeof jsx) => (...args: Parameters<typeof jsx>) => { const node = factory(...args) as ReactElement<Record<string, unknown>>; elements.push(node); return node }
  const Null = () => null
  const modules: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': { jsx: record(jsx), jsxs: record(jsxs), Fragment: React.Fragment },
    'react-router': { ...Router, useParams: () => ({ cacheId }), useNavigate: () => vi.fn() },
    '@tanstack/react-query': {
      useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === 'cache' ? cache : queryKey[0] === 'caches' ? [cache] : [], isPending: false, isError: false, isSuccess: true }),
      useQueryClient: () => ({ invalidateQueries: vi.fn() }),
      useMutation: () => ({ isPending: false, isError: false, isSuccess: false, reset: vi.fn(), mutate: vi.fn() }),
    },
    '../auth/AuthProvider': { useAuth: () => ({ me: { id: 'owner', display_name: 'Owner' } }), useProfile: () => ({ id: 'owner', display_name: 'Owner' }) },
    '../lib/feedback': { transientActionFailure },
    '../lib/api': { apiFetch, errorMessage }, '../lib/caches': caches, '../lib/invites': { shareInvite }, '../lib/requests': {}, '../lib/joining': joining,
    './OnboardingPage': { OnboardingPage: Null }, './AddItemSheet': { AddItemSheet: Null }, './JoinRequests': { JoinRequests: Null },
    '../components/Toast': { Toast, useToast: () => ({ toast: notice, showToast, dismissToast: () => { notice = null } }) },
    '../components/WideBreadcrumbs': { WideBreadcrumbs: Null }, '../components/Avatar': { Avatar: Null },
    '../components/Box': { boxColor: () => '#aebf92' }, '../components/MemberCats': { MemberCats: Null }, '../components/Stamp': { Stamp: Null },
    '../components/ThingTile': { ThingTile: Null, ThingStatus: Null },
    '../components/skeletons/CacheSkeleton': { CacheSkeleton: Null, CacheSettingsSkeleton: Null, CacheContentsSkeleton: Null, CacheErrorCard: Null, CacheEmptyCard: Null, CacheSettingsIcon: Null },
  }
  const compiled = ts.transpileModule(readFileSync(new URL(`../pages/${name}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} as Record<string, React.ComponentType> }
  new Function('require', 'module', 'exports', compiled)((key: string) => {
    if (!(key in modules)) throw new Error(`Unexpected ${name} dependency ${key}`)
    return modules[key]
  }, module, module.exports)
  vi.stubGlobal('location', { origin: 'https://communalcache.com' })
  function render() {
    elements.length = 0
    return renderToStaticMarkup(createElement(Router.MemoryRouter, null, createElement(React.Fragment, null, createElement(module.exports[name]), createElement(Toast, { toast: notice }))))
  }
  render()
  return {
    render, showToast, url: `https://communalcache.com/join/${cache.invite_token}`,
    copy() {
      const button = elements.find(element => element.type === 'button' && element.props.className === (name === 'CachePage' ? 'cc-cache-invite' : 'cc-pill'))!
      ;(button.props.onClick as () => void)()
    },
  }
}

it.each(['CachePage', 'CacheSettingsPage'] as const)('%s shows copy confirmation in the shared toast only after clipboard success', async name => {
  let copied!: () => void
  const clipboard = vi.fn(async () => new Promise<void>(resolve => { copied = resolve }))
  vi.stubGlobal('navigator', { clipboard: { writeText: clipboard } })
  const screen = page(name)
  screen.copy()
  expect(clipboard).toHaveBeenCalledExactlyOnceWith(screen.url)
  expect(screen.showToast).not.toHaveBeenCalled()
  copied()
  await vi.waitFor(() => expect(screen.showToast).toHaveBeenCalledWith('Invite copied.'))
  const html = screen.render()
  expect(html).toContain('class="cc-toast-region" role="status" aria-live="polite"')
  expect(html).toContain('class="cc-toast-message">Invite copied.</p>')
  expect(html).not.toContain('cc-cache-status')
})

it.each(['CachePage', 'CacheSettingsPage'] as const)('%s keeps copy failures visible as clear toast feedback', async name => {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('Clipboard unavailable') }) } })
  const screen = page(name)
  screen.copy()
  await vi.waitFor(() => expect(screen.showToast).toHaveBeenCalledOnce())
  expect(screen.showToast.mock.calls[0][0]).toContain('Could not')
  expect(screen.showToast.mock.calls[0][1]).toBe('error')
  expect(screen.render()).toContain('cc-toast-message')
  expect(screen.render()).not.toContain('Invite copied.')
})
