import { afterEach, expect, it, vi } from 'vitest'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { AppHeader } from '../components/AppHeader'
import { Tabs } from '../components/Tabs'
import { readFileSync } from 'node:fs'

const identity = { count: 2, userId: 'Mia', name: 'Mia', photoVersion: null }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([
  ['/', '/'], ['/caches/abc', '/'], ['/caches/abc/settings', '/'],
  ['/caches/abc/items/def', '/'], ['/items', '/items'], ['/items/abc/edit', '/items'],
  ['/requests', '/requests'], ['/requests/abc', '/requests'], ['/account', '/account'],
])('uses native links and the correct active section at %s', (path, current) => {
  const markup = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(Fragment, null, createElement(Tabs, identity), createElement(Tabs, { ...identity, mobile: true }))))
  const active = [...markup.matchAll(/<a(?=[^>]*aria-current="page")(?=[^>]*href="([^"]+)")[^>]*>/g)].map(match => match[1])
  expect(active).toEqual(current === '/account' ? ['/account'] : [current, current])
  for (const destination of ['/', '/items', '/requests', '/account']) expect(markup).toContain(`href="${destination}"`)
  expect(markup).toContain('aria-label="Desktop navigation"')
  expect(markup).toContain('aria-label="Mobile navigation"')
  expect(markup).toContain('Requests, 2 pending incoming on the first page')
  expect(markup).not.toMatch(/role="menu|tabindex="-1"|data-opening|private@example/)
})

it('keeps account a real destination, uses authorized photos and hides the shell for auth/incomplete profiles', () => {
  for (const path of ['/', '/account', '/login', '/auth/link', '/join/token']) {
    const client = new QueryClient()
    client.setQueryData(['me'], { id: 'Mia', display_name: 'Mia', email: 'private@example.test', profile_photo_version: 'photo' })
    client.setQueryData(['requests'], { pages: [{ requests: [], next_cursor: null, unavailable_cache_ids: [] }], pageParams: [null] })
    const render = () => renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, {
      children: createElement(MemoryRouter, { initialEntries: [path] }, createElement(AppHeader)),
    })))
    const markup = render()
    if (['/login', '/auth/link', '/join/token'].includes(path)) expect(markup).toBe('')
    else {
      expect(markup).toContain('aria-label="Home"')
      expect(markup).toContain('aria-label="Account"')
      expect(markup).toContain('src="/api/users/Mia/photo?v=photo"')
      expect(markup).not.toContain('cc-tab-badge')
      expect(markup).not.toContain('private@example.test')
    }
    client.setQueryData(['me'], { id: 'Mia', display_name: null })
    expect(render()).toBe('')
    client.setQueryData(['me'], null)
    expect(render()).toBe('')
    client.clear()
  }
})

it('reserves mobile safe area, uses the exact desktop chrome dimensions and has no route-delay wrapper', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  expect(css).toContain('height: 78px; min-height: 78px; padding: 20px 40px')
  expect(css).toContain('calc(84px + env(safe-area-inset-bottom,0px))')
  expect(css).toContain('env(safe-area-inset-left,0px)')
  expect(css).toContain('env(safe-area-inset-top,0px)')
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
  expect(app).toContain('cc-app-shell')
  expect(app).not.toContain('RouteMotion')
  const home = readFileSync(new URL('../pages/HomePage.tsx', import.meta.url), 'utf8')
  expect(home).toContain('<Link to={`/caches/${cache.id}`}')
  expect(home).not.toMatch(/CacheLink|PixelHorizon/)
})
