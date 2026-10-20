import { expect, it } from 'vitest'
import { createElement, type ComponentType } from 'react'
import * as React from 'react'
import * as Runtime from 'react/jsx-runtime'
import * as Router from 'react-router'
import * as Query from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import * as Cat from '../components/Cat'
import * as Stamp from '../components/Stamp'
import * as Box from '../components/Box'
import * as Avatar from '../components/Avatar'
import * as Tabs from '../components/Tabs'
import * as Skeleton from '../components/Skeleton'
import * as cats from './cats'
import * as contacts from './contacts'
import * as avatars from './avatars'
import * as config from './config'
import * as turnstile from './turnstile'

const parent = '2dfffd47f1bd59d39eb3fd52d8ad859898194cba'
const me = { id: 'owner', display_name: 'Neighbor', email: 'private-auth@example.test', cat_coat: 'grey' }
const modules: Record<string, unknown> = {
  react: React, 'react/jsx-runtime': Runtime, 'react-router': Router, '@tanstack/react-query': Query,
  './Cat': Cat, './Stamp': Stamp, './Box': Box, './Avatar': Avatar, './Tabs': Tabs, './Skeleton': Skeleton,
  '../lib/cats': cats, '../lib/contacts': contacts, '../lib/avatars': avatars, '../lib/config': config, '../lib/turnstile': turnstile,
  '../auth/AuthProvider': { useAuth: () => ({ me }) }, '../lib/caches': { useHomeSummary: () => ({ data: { pending_answer_count: 3 }, isError: false }) },
}
function load(file: string, frozen: boolean) {
  const source = frozen ? execFileSync('git', ['show', `${parent}:web/src/components/${file}.tsx`], { encoding: 'utf8' }) : readFileSync(new URL(`../components/${file}.tsx`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as Record<string, ComponentType<Record<string, unknown>>> }
  new Function('require', 'module', 'exports', compiled)((name: string) => { if (!(name in modules)) throw new Error(`Unknown parity dependency ${name}`); return modules[name] }, module, module.exports)
  return module.exports
}
function render(component: ComponentType<Record<string, unknown>>, props: Record<string, unknown>, path = '/') {
  const client = new Query.QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['config'], { turnstile_site_key: '' })
  const html = renderToStaticMarkup(createElement(Query.QueryClientProvider, { client }, createElement(Router.MemoryRouter, { initialEntries: [path] }, createElement(component, props))))
  client.clear()
  return html
}

it('retains shared markup apart from tested contrast/tour hooks, including every status/navigation branch', () => {
  const item = { id: 'item', cache_id: 'cache', title: '4-person tent', is_consumable: false, quantity: null, available: true, photo_version: null }
  const examples: [string, string, Record<string, unknown>, string?][] = [
    ['AuthScreen', 'AuthScreen', { children: 'Content' }], ['AuthScreen', 'AuthScreen', { children: 'Content', illustration: 'Art', className: 'route' }],
    ...['AuthBrand', 'SignInBox', 'BrandMark', 'MailIcon'].map(name => ['AuthScreen', name, {}] as [string, string, Record<string, unknown>]),
    ['Avatar', 'Avatar', { userId: me.id, name: me.display_name }], ['Avatar', 'Avatar', { userId: me.id, name: me.display_name, photoVersion: 'photo', size: 64 }],
    ['CoatPicker', 'CoatPicker', { userId: me.id, value: 'grey', onChange: () => {}, names: true }],
    ['CodeInput', 'CodeInput', { value: '', onChange: () => {} }], ['CodeInput', 'CodeInput', { value: '123456', onChange: () => {} }],
    ['MemberCats', 'MemberCats', { members: [], total: 0 }], ['MemberCats', 'MemberCats', { members: [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'c' }, { user_id: 'd' }], total: 9, limit: 4 }],
    ['InviteBox', 'InviteBox', { userId: me.id, loading: true }], ['InviteBox', 'InviteBox', { userId: me.id, pending: true, name: 'Tools' }],
    ['InviteBox', 'InviteBox', { userId: me.id, preview: { name: 'Tools', active_member_count: 7, members: ['a', 'b', 'c', 'd', 'e'].map(id => cats.catTraits(id)) } }],
    ['Skeleton', 'Shimmer', {}], ['Skeleton', 'Shimmer', { width: 32, height: 32, round: true }], ['Skeleton', 'LoadingStatus', { label: 'Loading…' }], ['Skeleton', 'LoadingLines', { label: 'Loading…', className: 'sample' }],
    ...['contents', 'library', 'members', 'requests', 'plain'].map(kind => ['Skeleton', 'SkeletonRows', { label: 'Loading…', kind }] as [string, string, Record<string, unknown>]),
    ['Turnstile', 'Turnstile', { action: 'signin', onToken: () => {} }],
    ...['/', '/login', '/auth/link', '/join/token', '/privacy', '/terms', '/items/a', '/requests/a', '/account'].map(path => ['AppHeader', 'AppHeader', {}, path] as [string, string, Record<string, unknown>, string]),
  ]
  for (const status of ['pending', 'approved', 'rejected']) examples.push(['RequestStatus', 'RequestStatus', { status }])
  for (const path of ['/', '/items', '/items/a', '/requests', '/requests/a', '/account']) for (const mobile of [false, true]) for (const count of [0, 1, 3]) {
    examples.push(['Tabs', 'Tabs', { mobile, count, userId: me.id, name: me.display_name }, path])
  }
  for (const kind of Object.keys(contacts.platforms)) {
    examples.push(['ContactLink', 'PlatformIcon', { kind }])
    examples.push(['ContactLink', 'ContactLink', { contact: { kind, value: 'chosen', link: kind === 'email' ? 'mailto:chosen@example.test' : 'https://example.test/chosen' }, name: '<Neighbor>' }])
  }
  for (const is_consumable of [false, true]) for (const available of [false, true]) for (const quantity of [null, 0, 3]) for (const pending of [0, 1, 3]) for (const compact of [false, true]) for (const quantityAsStatus of [false, true]) {
    examples.push(['ThingTile', 'ThingStatus', { item: { ...item, is_consumable, available, quantity, unavailable_note: 'With a neighbor' }, pending, compact, quantityAsStatus }])
  }
  for (const library of [false, true]) for (const photo_version of [null, 'a/b?c']) examples.push(['ThingTile', 'ThingTile', { item: { ...item, photo_version }, library }])
  const exports = new Map<string, ReturnType<typeof load>>()
  const fingerprint = createHash('sha256')
  for (const [file, name, props, path] of examples) {
    if (!exports.has(file)) exports.set(file, load(file, process.env.COMPONENT_PARITY_PARENT === '1'))
    // Contrast and tour targets are tested separately; keep other parent markup pinned.
    let html = render(exports.get(file)![name], props, path)
      .replace(/ data-cat-backdrop="(?:ginger|grey|dusk|oat|ash|toffee)"/g, '')
      .replace(/ data-tour="(?:items|requests|account)"/g, '')
    if (file === 'Turnstile' && process.env.COMPONENT_PARITY_PARENT !== '1') {
      // Both callers now own feedback; only the old inline unavailable UI is removed.
      expect(html).toBe('<section class="mt-3" aria-label="Bot protection"><div></div></section>')
      html = html.replace('</section>', '<div><p role="alert" class="text-sm text-red-700">Bot protection is unavailable. Please retry.</p><button type="button" class="mt-2 text-sm underline">Retry bot check</button></div></section>')
    }
    fingerprint.update(file + '\0' + name + '\0' + (path ?? '/') + '\0' + html + '\0')
  }
  // Pin parent output so shallow CI checkouts do not need historical Git objects.
  expect(fingerprint.digest('hex')).toBe('d1f5384429667e5e44fdc878246ee7bcf4a2d81c1bcfc824c2ada2bd7528e7a2')
  expect(examples.length).toBeGreaterThan(200)
})
