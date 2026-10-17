import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ReactElement } from 'react'
import * as React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { apiFetch } from './api'
import { adminListPath, setAdminFlag, setAdminPlan, type AdminFlag } from './admin'

afterEach(() => vi.restoreAllMocks())

function control(onSaved: () => Promise<void>) {
  const states: unknown[] = []
  let stateIndex = 0, input!: ReactElement<Record<string, unknown>>
  let flag: AdminFlag = { key: 'google_sign_in', enabled: true, updated_at: 1 }
  const record = (factory: typeof jsx) => (...args: Parameters<typeof jsx>) => {
    const node = factory(...args) as ReactElement<Record<string, unknown>>
    if (node.type === 'input') input = node
    return node
  }
  const modules: Record<string, unknown> = {
    react: { ...React, useState(initial: unknown) {
      const index = stateIndex++
      if (!(index in states)) states[index] = initial
      return [states[index], (value: unknown) => { states[index] = value }]
    } },
    'react/jsx-runtime': { jsx: record(jsx), jsxs: record(jsxs) },
    'react-router': {}, '@tanstack/react-query': {}, '../auth/AuthProvider': {},
    '../lib/api': { apiFetch }, '../lib/admin': { adminListPath, setAdminFlag, setAdminPlan },
  }
  const source = readFileSync(new URL('../pages/AdminPage.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as { FlagControl: React.ComponentType<{ flag: AdminFlag; onSaved: () => Promise<void> }> } }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected dependency ${name}`)
    return modules[name]
  }, module, module.exports)
  function render() {
    stateIndex = 0
    return renderToStaticMarkup(createElement(module.exports.FlagControl, { flag, onSaved }))
  }
  render()
  return {
    render, get checked() { render(); return input.props.checked }, get disabled() { render(); return input.props.disabled },
    toggle() { (input.props.onChange as () => void)() },
    refreshed(enabled: boolean) { flag = { ...flag, enabled } },
  }
}

it('keeps the switch at server state while PATCH and refetch are pending, then accepts the refetched value', async () => {
  let respond!: (response: Response) => void, refetched!: () => void
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Promise<Response>(resolve => { respond = resolve }))
  const onSaved = vi.fn(async () => new Promise<void>(resolve => { refetched = resolve }))
  const page = control(onSaved)
  page.toggle()
  expect(page.disabled).toBe(true)
  expect(page.checked).toBe(true)
  expect(page.render()).toContain('Saving…')
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/admin/flags/google_sign_in', expect.objectContaining({ method: 'PATCH', credentials: 'same-origin', body: '{"enabled":false}' }))
  respond(Response.json({ key: 'google_sign_in', enabled: false }))
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  expect(page.checked).toBe(true)
  expect(page.disabled).toBe(true)
  page.refreshed(false); refetched()
  await vi.waitFor(() => expect(page.disabled).toBe(false))
  expect(page.checked).toBe(false)
})

it('retains the server value and exposes a clear retry error when saving fails', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'internal_error' }, { status: 503 }))
  const onSaved = vi.fn(async () => {})
  const page = control(onSaved)
  page.toggle()
  await vi.waitFor(() => expect(page.disabled).toBe(false))
  expect(page.checked).toBe(true)
  expect(page.render()).toContain('role="alert"')
  expect(page.render()).toContain('Could not change switch. Refresh and try again.')
  expect(onSaved).not.toHaveBeenCalled()
})
