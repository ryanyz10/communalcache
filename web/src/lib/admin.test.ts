import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { AdminPage } from '../pages/AdminPage'
import { adminListPath, setAdminFlag, setAdminPlan } from './admin'
import { readFileSync } from 'node:fs'

const id = '11111111-1111-4111-8111-111111111111'
afterEach(() => vi.restoreAllMocks())
function render(mode: 'ready' | 'loading' | 'denied' | 'signed-out' = 'ready') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['me'], mode === 'signed-out' ? null : { id, display_name: 'Admin name', email: 'admin-private@example.test' })
  if (mode !== 'loading') client.setQueryData(['admin', id, 'overview'], { users: 2, caches: 1, items: 3, pending_requests: 4, outbox_pending: 5, outbox_failed: 1, outbox_oldest_age_ms: 90_000, cleanup_pending: 7, cleanup_oldest_age_ms: 120_000, plans: [{ plan: 'free' }, { plan: 'plus' }] })
  if (mode === 'denied') client.getQueryCache().find({ queryKey: ['admin', id, 'overview'] })!.setState({ status: 'error', error: new Error('not found') })
  client.setQueryData(['admin', id, 'caches', null], { rows: [{ id, name: 'Tools', owner_id: id, owner_name: 'Owner name', plan: 'free', member_count: 12, member_limit: 30, item_count: 3 }], next_cursor: id })
  client.setQueryData(['admin', id, 'users', null], { rows: [{ id, display_name: 'Neighbor name', plan: 'free', owned_caches: 1, owned_cache_limit: 1, owned_items: 3, owned_item_limit: 100, pending_outgoing: 4, pending_limit: 20, memberships: 2, membership_limit: 20, new_caches_24h: 1, new_cache_limit: 2, profile_photos: 0, profile_photo_limit: 1 }], next_cursor: null })
  client.setQueryData(['admin', id, 'flags'], { flags: [{ key: 'google_sign_in', enabled: true, updated_at: 1_000 }] })
  client.setQueryData(['admin', id, 'failed-outbox', null], { rows: [{ id, kind: 'request_created', created_at: 1_000, failed_at: 2_000, attempts: 6, error_class: null }], next_cursor: null })
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, null, createElement(AdminPage)) })))
  client.clear()
  return html
}

it('renders cozy operational tables, policy-derived plan choices and safe metadata without email or payloads', () => {
  const html = render()
  for (const text of ['Admin', 'Caches', 'Users', 'Failed outbox', 'Owner name', 'Neighbor name', id, '12 / 30', '3 / 100', '4 / 20', 'Not recorded', 'Photo cleanup:', '2 min', 'Switches', 'Google sign-in', 'Plan for', 'First caches page', 'Next caches page']) expect(html).toContain(text)
  expect(html).toContain('<option value="free" selected="">free</option>')
  expect(html).toContain('<option value="plus">plus</option>')
  expect(html).toContain('role="switch" aria-label="Google sign-in" aria-checked="true"')
  expect(html).toContain('checked=""')
  expect(html).toContain('scope="col"')
  expect(html).toContain('role="region" aria-label="Users table" tabindex="0"')
  expect(html).not.toContain('admin-private@example.test')
  expect(html).not.toMatch(/<img|<a[^>]+href="\/admin"|Suspend|Impersonate/)
})

it('keeps loading, signed-out and denied states free of operational rows', () => {
  expect(render('loading')).toContain('Loading…')
  for (const mode of ['signed-out', 'denied'] as const) {
    const html = render(mode)
    expect(html).toContain('This page is not available.')
    expect(html).not.toContain('Neighbor name')
    expect(html).not.toContain('Owner name')
  }
})

it('uses explicit cursor requests and same-origin PATCH bodies without user-supplied SQL', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id, plan: 'plus' }))
  expect(adminListPath('caches', null)).toBe('/api/admin/caches')
  expect(adminListPath('users', id)).toBe('/api/admin/users?after=' + id)
  expect(adminListPath('failed-outbox', 'unsafe?cursor')).toBe('/api/admin/failed-outbox?after=unsafe%3Fcursor')
  await setAdminPlan('users', id, 'plus')
  expect(fetch).toHaveBeenCalledWith(`/api/admin/users/${id}/plan`, expect.objectContaining({ method: 'PATCH', credentials: 'same-origin', body: '{"plan":"plus"}' }))
})

it('PATCHes only the selected switch boolean with same-origin cookies', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ key: 'google_sign_in', enabled: false }))
  await setAdminFlag('google_sign_in', false)
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/admin/flags/google_sign_in', expect.objectContaining({ method: 'PATCH', credentials: 'same-origin', body: '{"enabled":false}' }))
})

it('keeps admin SQL explicit and never selects authentication/contact fields or raw outbox contents', () => {
  const sql = readFileSync(new URL('../../../src/db/admin.ts', import.meta.url), 'utf8')
  expect(sql).not.toMatch(/\bemail\b|\bpayload\b|\bvalue\b|SELECT\s+\*/i)
  expect(sql).toContain('AND EXISTS(SELECT 1 FROM plan_limits WHERE plan=?) AND ${currentAdminSession}')
  expect(sql).toContain('s.userId=? AND s.token=? AND s.expiresAt>?')
  expect(readFileSync(new URL('../components/AppHeader.tsx', import.meta.url), 'utf8')).not.toContain('/admin')
  const config = JSON.parse(readFileSync(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8'))
  expect(config.assets.run_worker_first).toEqual(expect.arrayContaining(['/admin', '/admin/*']))
  expect(config.vars.ADMIN_USER_IDS).toBeUndefined()
  expect(config.env.production.vars.ADMIN_USER_IDS).toBe('4f037f1f-5e2a-4241-876e-abdb938bfeb7')
})
