import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Ready } from '../App'
import { AuthProvider, useAuth } from '../auth/AuthProvider'
import { HomeSkeleton, HomeBoxesSkeleton } from '../components/skeletons/HomeSkeleton'
import { CacheSkeleton, CacheSettingsSkeleton, CacheContentsSkeleton, CacheErrorCard, CacheEmptyCard, CacheLoadingChips, CacheSettingsIcon } from '../components/skeletons/CacheSkeleton'
import { LibrarySkeleton } from '../components/skeletons/LibrarySkeleton'
import { ItemSkeleton, ItemEditorSkeleton } from '../components/skeletons/ItemSkeletons'
import { RequestsSkeleton, RequestDetailSkeleton } from '../components/skeletons/RequestSkeletons'
import { AccountSkeleton } from '../components/skeletons/AccountSkeleton'
import { RouteSkeleton } from '../components/skeletons/RouteSkeleton'
import { InviteBox } from '../components/InviteBox'
import { LoadingStatus, Shimmer, SkeletonRows } from '../components/Skeleton'
import { hasSessionHint, setSessionHint } from './sessionHint'
import { readFileSync } from 'node:fs'
import { startSlowNotice, type CacheSummary } from './caches'

vi.mock('./push', () => ({ disablePush: vi.fn(async () => {}) }))
const id = '11111111-1111-4111-8111-111111111111'
let store: Map<string, string>
beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function render(element: ReactElement) { return renderToStaticMarkup(createElement(MemoryRouter, null, element)) }

for (const [name, element] of [
  ['home', createElement(HomeSkeleton)],
  ['cache', createElement(CacheSkeleton, { cacheId: id })],
  ['library', createElement(LibrarySkeleton)],
  ['item', createElement(ItemSkeleton)],
  ['editor', createElement(ItemEditorSkeleton)],
  ['requests', createElement(RequestsSkeleton)],
  ['request-detail', createElement(RequestDetailSkeleton)],
  ['account', createElement(AccountSkeleton)],
  ['cache-settings', createElement(CacheSettingsSkeleton, { cacheId: id })],
] as const) {
  it(`${name} skeleton keeps its layout, hidden loading status and no invented data`, () => {
    const fetch = vi.spyOn(globalThis, 'fetch'), html = render(element)
    expect(html).toContain(`data-skeleton="${name}"`)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('role="status" class="sr-only">Loading')
    expect(html).toContain('aria-hidden="true" class="cc-shimmer')
    expect(html).not.toMatch(/Ryan|Maya|Maple|example\.|mailto:|sms:|\d+ neighbors|<img|\/api\//)
    expect(fetch).not.toHaveBeenCalled()
  })
}

it('retains the pre-split markup fingerprint for every exported skeleton', () => {
  vi.spyOn(Date.prototype, 'getHours').mockReturnValue(14)
  const retry = () => {}
  const examples: [string, ReactElement][] = [
    ['CacheSettingsIcon', createElement(CacheSettingsIcon)],
    ['CacheLoadingChips', createElement(CacheLoadingChips, { slow: false })],
    ['CacheLoadingChips', createElement(CacheLoadingChips, { slow: true })],
    ['CacheContentsSkeleton', createElement(CacheContentsSkeleton)],
    ['CacheErrorCard', createElement(CacheErrorCard, { message: 'Original read error', retry })],
    ['CacheEmptyCard', createElement(CacheEmptyCard, { onAdd: retry })],
    ['CacheSkeleton', createElement(CacheSkeleton, { cacheId: id })],
    ['HomeBoxesSkeleton', createElement(HomeBoxesSkeleton)],
    ['HomeSkeleton', createElement(HomeSkeleton)],
    ['LibrarySkeleton', createElement(LibrarySkeleton)],
    ['ItemSkeleton', createElement(ItemSkeleton)],
    ['ItemEditorSkeleton', createElement(ItemEditorSkeleton)],
    ['RequestsSkeleton', createElement(RequestsSkeleton)],
    ['RequestDetailSkeleton', createElement(RequestDetailSkeleton)],
    ['AccountSkeleton', createElement(AccountSkeleton)],
    ['CacheSettingsSkeleton', createElement(CacheSettingsSkeleton, { cacheId: id })],
    ['RouteSkeleton', createElement(RouteSkeleton, { pathname: `/caches/${id}` })],
  ]
  const hash = createHash('sha256')
  for (const [name, element] of examples) hash.update(name + '\0' + render(element) + '\0')
  expect(hash.digest('hex')).toBe('4b3e445bd51eded27f237ccc42a010b8e0c3f6cda84e8dad5b4550df98fb0ad8')
})

it.each([undefined, 0, 1, 30, 100])('preserves member rows and the missing-count fallback for %s', count => {
  const summary = count === undefined ? undefined : {
    id, name: 'Known cache', owner_id: 'owner', requires_approval: false,
    active_member_count: count, attached_item_count: 0, pending_answer_count: 0, member_preview: [],
  }
  const html = render(createElement(CacheSkeleton, { cacheId: id, summary }))
  expect(html.match(/class="cc-skeleton-row"/g)).toHaveLength(4 + (count ?? 4))
})

it('keeps the authorized Home summary real while only contents/member details shimmer', () => {
  const summary: CacheSummary = { id, name: 'Known cache', owner_id: 'owner', requires_approval: true, active_member_count: 6, attached_item_count: 24, pending_answer_count: 1, member_preview: [] }
  const html = render(createElement(CacheSkeleton, { cacheId: id, summary }))
  expect(html).toContain('Known cache')
  expect(html).toContain('6 neighbors · 24 things')
  expect(html).toContain('approves joins')
  expect(html).toContain('>Invite</button>')
  expect(html).toContain('+ Add item')
  expect(html.match(/class="cc-skeleton-row"/g)).toHaveLength(10)
  expect(html).not.toContain('Cordless drill')
})

it('uses desktop table columns rather than mobile two-line rows, and one name bar per member', () => {
  const html = render(createElement(CacheContentsSkeleton))
  expect(html).toContain('<span>Thing</span><span>From</span><span>Status</span>')
  expect(html.match(/cc-skeleton-desktop-title/g)).toHaveLength(4)
  expect(html.match(/cc-skeleton-desktop-from/g)).toHaveLength(4)
  expect(html.match(/width:26px;height:26px;border-radius:50%/g)).toHaveLength(4)
  expect(html).not.toContain('Still loading.')
  const members = render(createElement(SkeletonRows, { label: 'Loading members…', kind: 'members', count: 6 }))
  expect(members.match(/class="cc-skeleton-row"/g)).toHaveLength(6)
  for (const row of members.matchAll(/<div class="cc-skeleton-row-copy">([\s\S]*?)<\/div>/g)) expect(row[1].match(/cc-shimmer/g)).toHaveLength(1)
})

it('replaces the loading chips with the exact slow notice at 6000ms, not at 5999ms', () => {
  vi.useFakeTimers()
  let slow = false
  const reveal = vi.fn(() => { slow = true })
  const cancel = startSlowNotice(reveal)
  const paint = () => render(createElement(CacheLoadingChips, { slow }))
  expect(paint()).toContain('cc-skeleton-filter-chips')
  expect(paint()).not.toContain('Still loading.')
  vi.advanceTimersByTime(5999)
  expect(reveal).not.toHaveBeenCalled()
  expect(paint()).toContain('cc-skeleton-filter-chips')
  vi.advanceTimersByTime(1)
  expect(reveal).toHaveBeenCalledOnce()
  expect(paint()).toContain('role="status" class="cc-cache-slow"')
  expect(paint()).toContain('Still loading. This is taking longer than usual.')
  expect(paint()).not.toContain('cc-skeleton-filter-chips')
  vi.advanceTimersByTime(6000)
  expect(reveal).toHaveBeenCalledOnce()
  cancel()
})

it('cancels the slow-notice clock when loading unmounts before six seconds', () => {
  vi.useFakeTimers()
  const reveal = vi.fn(), cancel = startSlowNotice(reveal)
  vi.advanceTimersByTime(5999)
  cancel()
  expect(vi.getTimerCount()).toBe(0)
  vi.advanceTimersByTime(6001)
  expect(reveal).not.toHaveBeenCalled()
})

it('keeps error diagnostics/retry and an honest empty add entry without fake data', () => {
  const error = render(createElement(CacheErrorCard, { message: 'Original read error', retry: () => {} }))
  for (const text of ['role="alert"', 'RETURN TO SENDER', 'Couldn&#x27;t open this box', 'Original read error', 'Try again']) expect(error).toContain(text)
  expect(error).not.toContain('cc-shimmer')
  const empty = render(createElement(CacheEmptyCard, { onAdd: () => {} }))
  expect(empty).toContain('cc-cache-empty-card')
  expect(empty).toContain('Nothing in here yet')
  expect(empty).toContain('+ Add the first thing')
  expect(empty).not.toMatch(/neighbors|\d+ things|cc-shimmer/)
})

it('gives the join preview a status and unknown name/count bars, not an invented cache', () => {
  const html = render(createElement('div', null, createElement(LoadingStatus, { label: 'Loading invitation…' }), createElement(InviteBox, { userId: id, loading: true })))
  expect(html).toContain('role="status" class="sr-only">Loading invitation…')
  expect(html).toContain('cc-shimmer')
  expect(html).not.toContain('Your invitation')
  expect(html).not.toMatch(/neighbors|Maple/)
})

function startup(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, { initialEntries: [path] }, createElement(Ready, { children: createElement('p', null, 'resolved') })) })))
  client.clear()
  return html
}

it('never flashes private app chrome for a device with no successful signed-in hint', () => {
  for (const path of ['/', '/items', `/caches/${id}`, '/account', '/login']) {
    const html = startup(path)
    expect(html).toContain('cc-neutral-loading')
    expect(html).toContain('role="status" class="sr-only">Loading…')
    expect(html).not.toMatch(/Desktop navigation|Your caches|cc-shimmer|data-skeleton/)
  }
})

it('uses only a boolean device hint for route-aware startup chrome and never fetches private data', () => {
  setSessionHint(true)
  const fetch = vi.spyOn(globalThis, 'fetch')
  for (const [path, page] of [['/', 'home'], ['/items', 'library'], ['/items/new', 'editor'], ['/items/x', 'item'], ['/items/x/edit', 'editor'], [`/caches/${id}`, 'cache'], [`/caches/${id}/settings`, 'cache-settings'], ['/requests', 'requests'], ['/requests/x', 'request-detail'], ['/account', 'account']]) {
    const html = startup(path)
    expect(html).toContain(`data-skeleton="${page}"`)
    expect(html).toContain('Desktop navigation')
    expect(html).not.toMatch(/example\.|\/api\/|data-user-id|Ryan/)
  }
  for (const path of ['/login', '/auth/link', `/join/${id}.${'A'.repeat(43)}`]) expect(startup(path)).toContain('cc-neutral-loading')
  expect(fetch).not.toHaveBeenCalled()
  expect([...store.entries()]).toEqual([['cc_signed_in', '1']])
})

it('sets the hint only after a real successful identity read and clears it on 401 and successful sign-out', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let auth: ReturnType<typeof useAuth> | undefined
  function Capture() { auth = useAuth(); return null }
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(Capture) })))
  const identityQuery = { ...client.getQueryCache().find({ queryKey: ['me'] })!.options, queryKey: ['me'] }
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ id, email: 'self@example.test', display_name: 'Self' }))
  expect(hasSessionHint()).toBe(false)
  await client.fetchQuery(identityQuery)
  expect(hasSessionHint()).toBe(true)
  fetch.mockResolvedValueOnce(Response.json({ error: 'unauthorized' }, { status: 401 }))
  await client.fetchQuery(identityQuery)
  expect(hasSessionHint()).toBe(false)
  setSessionHint(true)
  fetch.mockResolvedValueOnce(Response.json({ success: true }))
  await auth!.signOut()
  expect(hasSessionHint()).toBe(false)
  expect(client.getQueryData(['me'])).toBeNull()
  fetch.mockResolvedValueOnce(Response.json({ error: 'unavailable' }, { status: 503 }))
  await expect(client.fetchQuery(identityQuery)).rejects.toMatchObject({ status: 503 })
  expect(hasSessionHint()).toBe(false)
  setSessionHint(true)
  fetch.mockResolvedValueOnce(Response.json({ error: 'unavailable' }, { status: 503 }))
  await expect(auth!.signOut()).rejects.toMatchObject({ status: 503 })
  expect(hasSessionHint()).toBe(true)
  client.clear()
})

it('tolerates denied storage without using an in-memory authorization shortcut', () => {
  vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } })
  expect(() => { setSessionHint(true); setSessionHint(false) }).not.toThrow()
  expect(hasSessionHint()).toBe(false)
})

it('shares the exact handoff ramp/timing, static reduced motion, and decorative bars', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  expect(css).toContain('--cc-shine: #f3e7d4')
  expect(css).toContain('--cc-shine: #5a5348')
  expect(css).toContain('animation: cc-shimmer 1.6s linear infinite')
  expect(css).toContain('background-position: -100% 0')
  expect(css).toMatch(/\.cc-shimmer\s*\{\s*animation: none;\s*background: var\(--cc-chip\);\s*\}/)
  expect(css).toContain('animation: cc-placeholder-exit 350ms ease-out both')
  expect(css).toContain('animation: cc-cache-row-enter 400ms ease-out both')
  expect(css).toContain('animation: cc-skeleton-swap 200ms ease-out both')
  expect(render(createElement(Shimmer))).toContain('aria-hidden="true"')
})
