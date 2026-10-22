import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, type NavigateProps } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppRoutes, Ready } from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import { ToastProvider } from '../components/Toast'
import { ProductTourProvider } from '../components/ProductTour'

// SSR does not run Navigate's effect; record its exact destination/options instead.
vi.mock('react-router', async importOriginal => ({
  ...await importOriginal<typeof import('react-router')>(),
  Navigate: ({ to, replace, state }: NavigateProps) => createElement('output', {
    'data-redirect': JSON.stringify({ to, replace, state: state ?? null }),
  }),
}))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const routes = [
  ['/requests', 'class="organic-requests"'],
  ['/requests/request', 'class="organic-request-detail"'],
  ['/items', 'data-skeleton="library"'],
  ['/items/new', 'id="item-title"'],
  ['/items/item', 'data-skeleton="item"'],
  ['/items/item/edit', 'Loading item editor…'],
  ['/account', 'class="cc-account-page"'],
  ['/caches/cache/settings', 'data-skeleton="cache-settings"'],
  ['/caches/cache', 'data-skeleton="cache"'],
  ['/caches/cache/items/new', 'Loading item editor…'],
  ['/caches/cache/items/item', 'data-skeleton="item"'],
  ['/caches/cache/items/item/edit', 'Loading item editor…'],
] as const
const states = ['loading', 'signed-out', 'onboarding', 'profile'] as const

for (const [path, screen] of routes) {
  it.each(states)(`${path} preserves the %s route contract`, state => {
    vi.stubGlobal('localStorage', { getItem: () => null })
    const fetch = vi.spyOn(globalThis, 'fetch')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    if (state !== 'loading') client.setQueryData(['me'], state === 'signed-out' ? null : {
      id: 'owner', email: 'self@example.test', display_name: state === 'onboarding' ? null : 'Owner',
    })
    const render = () => renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(AuthProvider, { children: createElement(MemoryRouter, { initialEntries: [path + '?keep=1#section'] },
        createElement(ProductTourProvider, { children: createElement(ToastProvider, {
          children: createElement(Ready, { children: createElement(AppRoutes) }),
        }) })) })))
    try {
      const html = render()
      if (state === 'loading') {
        expect(html).toContain('class="cc-neutral-loading"')
        expect(html).not.toMatch(/data-redirect|What should neighbors call you/)
        vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'cc_signed_in' ? '1' : null })
        const hinted = render()
        expect(hinted).toContain('class="cc-app-shell"')
        expect(hinted).toContain('data-skeleton=')
        expect(hinted).not.toContain('data-redirect')
      } else if (state === 'signed-out') {
        expect(html).toBe('<output data-redirect="{&quot;to&quot;:&quot;/login&quot;,&quot;replace&quot;:true,&quot;state&quot;:null}"></output><div class="cc-toast-region" role="status" aria-live="polite" aria-atomic="true"></div>')
      } else if (state === 'onboarding') {
        expect(html).toContain('What should neighbors call you?')
        expect(html).toContain('id="display_name"')
        expect(html).not.toMatch(/data-redirect|data-skeleton=|cc-account-page|organic-requests/)
      } else {
        expect(html).toContain(screen)
        expect(html).not.toMatch(/data-redirect|What should neighbors call you/)
      }
      expect(fetch).not.toHaveBeenCalled()
    } finally { client.clear() }
  })
}
