import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { AccountMenu } from '../components/AccountMenu'
import { accountMenuLabel, bindAccountMenu } from './accountMenu'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function menuFixture() {
  const listeners = new Map<string, (event: unknown) => void>()
  const doc = {
    activeElement: null as unknown,
    addEventListener: vi.fn((type: string, listener: (event: unknown) => void) => { listeners.set(type, listener) }),
    removeEventListener: vi.fn((type: string, listener: (event: unknown) => void) => { if (listeners.get(type) === listener) listeners.delete(type) }),
  }
  vi.stubGlobal('document', doc)
  const trigger = { focus: vi.fn(() => { doc.activeElement = trigger }) }
  const requests = { disabled: false, focus: vi.fn(() => { doc.activeElement = requests }), click: vi.fn() }
  const account = { disabled: false, focus: vi.fn(() => { doc.activeElement = account }), click: vi.fn() }
  const logout = { disabled: false, focus: vi.fn(() => { doc.activeElement = logout }), click: vi.fn() }
  const choices = [requests, account, logout]
  const menu = { hidden: true, querySelectorAll: vi.fn(() => choices.filter(item => !item.disabled)) }
  const root = { contains: vi.fn((target: unknown) => target === trigger || target === menu || choices.includes(target as typeof requests)) }
  let open = false
  const close = vi.fn(() => { open = false; menu.hidden = true })
  function show() {
    open = true; menu.hidden = false
    return bindAccountMenu(root as unknown as HTMLElement, trigger as unknown as HTMLButtonElement, menu as unknown as HTMLElement, close)
  }
  function key(value: string) {
    const event = { key: value, preventDefault: vi.fn() }
    listeners.get('keydown')?.(event)
    return event
  }
  return { doc, trigger, requests, account, logout, menu, listeners, close, show, key, isOpen: () => open }
}

it('opening the menu focuses Requests and Escape closes it with focus restored to the profile button', () => {
  const view = menuFixture()
  expect(view.isOpen()).toBe(false)
  const cleanup = view.show()
  expect(view.isOpen()).toBe(true)
  expect(view.menu.hidden).toBe(false)
  expect(view.doc.activeElement).toBe(view.requests)
  const escape = view.key('Escape')
  expect(escape.preventDefault).toHaveBeenCalledOnce()
  expect(view.isOpen()).toBe(false)
  expect(view.menu.hidden).toBe(true)
  expect(view.doc.activeElement).toBe(view.trigger)
  cleanup()
  expect(view.listeners.size).toBe(0)
})

it('supports arrow wrap, Home/End and disabled-item skipping without trapping Tab', () => {
  const view = menuFixture(), cleanup = view.show()
  view.key('ArrowUp')
  expect(view.doc.activeElement).toBe(view.logout)
  view.key('ArrowDown')
  expect(view.doc.activeElement).toBe(view.requests)
  view.key('ArrowDown')
  expect(view.doc.activeElement).toBe(view.account)
  view.logout.disabled = true
  view.key('End')
  expect(view.doc.activeElement).toBe(view.account)
  view.key('Home')
  expect(view.doc.activeElement).toBe(view.requests)
  const tab = view.key('Tab')
  expect(view.isOpen()).toBe(false)
  expect(tab.preventDefault).not.toHaveBeenCalled()
  expect(view.doc.activeElement).toBe(view.trigger)
  cleanup()
})

it('activates the focused menu item with Space without scrolling or activating another item', () => {
  const view = menuFixture(), cleanup = view.show()
  const event = view.key(' ')
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(view.requests.click).toHaveBeenCalledOnce()
  expect(view.account.click).not.toHaveBeenCalled()
  expect(view.logout.click).not.toHaveBeenCalled()
  cleanup()
})

it('keeps inside pointer events open, dismisses outside events and removes both listeners on cleanup', () => {
  const view = menuFixture(), cleanup = view.show()
  view.listeners.get('pointerdown')?.({ target: view.account })
  expect(view.close).not.toHaveBeenCalled()
  view.listeners.get('pointerdown')?.({ target: {} })
  expect(view.close).toHaveBeenCalledOnce()
  expect(view.doc.activeElement).toBe(view.trigger)
  cleanup()
  expect(view.doc.removeEventListener).toHaveBeenCalledTimes(2)
  expect(view.listeners.size).toBe(0)
})

it('renders the same accessible menu and badges for phone/desktop without another user email or always-visible navigation', () => {
  const client = new QueryClient()
  client.setQueryData(['me'], { id: 'caller', display_name: 'Ryan', email: 'private@example.test' })
  const menu = createElement(AccountMenu, { name: 'Ryan', count: 2 })
  const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AuthProvider, { children: createElement(MemoryRouter, null, menu) })))
  expect(markup).toContain('aria-label="Account menu, 2 requests need your answer"')
  expect(markup).toContain('aria-haspopup="menu"')
  expect(markup).toContain('aria-expanded="false"')
  expect(markup).toContain('aria-controls="account-menu"')
  expect(markup).toContain('role="menu" aria-label="Account menu" hidden=""')
  expect(markup.match(/role="menuitem"/g)).toHaveLength(3)
  expect(markup).toContain('href="/requests"')
  expect(markup).toContain('href="/account"')
  expect(markup).toContain('Account settings')
  expect(markup).toContain('Sign out')
  expect(markup).toContain('Requests, 2 pending incoming on the first page')
  expect(markup.match(/>2<\/span>/g)).toHaveLength(2)
  expect(markup).not.toContain('private@example.test')
  expect(accountMenuLabel(0)).toBe('Account menu')
  expect(accountMenuLabel(1)).toBe('Account menu, 1 request needs your answer')
  client.clear()
})
