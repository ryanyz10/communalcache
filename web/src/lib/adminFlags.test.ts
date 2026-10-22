import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ReactElement } from 'react'
import * as React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { apiFetch } from './api'
import * as config from './config'
import { adminListPath, setAdminFlag, setAdminPlan, type AdminFlag } from './admin'
import { toastFixture } from '../test/toastFixture'

afterEach(() => vi.restoreAllMocks())

function control(onSaved: () => Promise<void>, kind: 'flag' | 'plan' = 'flag') {
  const toasts = toastFixture()
  const states: unknown[] = []
  let stateIndex = 0, input!: ReactElement<Record<string, unknown>>, form!: ReactElement<Record<string, unknown>>
  let flag: AdminFlag = { key: 'google_sign_in', enabled: true, updated_at: 1 }
  const record = (factory: typeof jsx) => (...args: Parameters<typeof jsx>) => {
    const node = factory(...args) as ReactElement<Record<string, unknown>>
    if (node.type === 'input' || node.type === 'select') input = node
    if (node.type === 'form') form = node
    return node
  }
  const modules: Record<string, unknown> = {
    ...toasts.modules,
    react: { ...React, useState(initial: unknown) {
      const index = stateIndex++
      if (!(index in states)) states[index] = initial
      return [states[index], (value: unknown) => { states[index] = value }]
    } },
    'react/jsx-runtime': { jsx: record(jsx), jsxs: record(jsxs) },
    'react-router': {}, '@tanstack/react-query': {}, '../auth/AuthProvider': {},
    '../lib/api': { apiFetch }, '../lib/admin': { adminListPath, setAdminFlag, setAdminPlan }, '../lib/config': config,
  }
  const source = readFileSync(new URL('../pages/AdminPage.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source + '\nexport { PlanControl }', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as {
    FlagControl: React.ComponentType<{ flag: AdminFlag; onSaved: () => Promise<void> }>
    PlanControl: React.ComponentType<{ kind: 'users'; id: string; plan: string; plans: { plan: string }[]; onSaved: () => Promise<void> }>
  } }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected dependency ${name}`)
    return modules[name]
  }, module, module.exports)
  function render() {
    stateIndex = 0
    const element = kind === 'flag' ? createElement(module.exports.FlagControl, { flag, onSaved }) : createElement(module.exports.PlanControl, { kind: 'users', id: 'owner', plan: 'free', plans: [{ plan: 'free' }, { plan: 'plus' }], onSaved })
    return renderToStaticMarkup(createElement(React.Fragment, null, element, toasts.element()))
  }
  render()
  return {
    toasts, render, get checked() { render(); return input.props.checked }, get disabled() { render(); return input.props.disabled },
    toggle() { (input.props.onChange as () => void)() },
    select(value: string) { (input.props.onChange as (event: unknown) => void)({ target: { value } }); render() },
    submit() { return (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} }) },
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
  expect(page.toasts.notice).toMatchObject({ message: 'Could not change switch. Refresh and try again.', tone: 'error' })
  expect(page.render()).not.toContain('<span role="alert">')
})

it.each(['flag', 'plan'] as const)('keeps %s validation/state failures next to the control rather than in a toast', async kind => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  const onSaved = vi.fn(async () => {})
  const page = control(onSaved, kind)
  for (const status of [400, 409]) {
    fetch.mockResolvedValueOnce(Response.json({ error: 'invalid_plan' }, { status }))
    if (kind === 'plan') { page.select('plus'); await page.submit() }
    else { page.toggle(); await vi.waitFor(() => expect(page.disabled).toBe(false)) }
    expect(page.toasts.notice).toBeNull()
    const message = kind === 'plan' ? 'Could not save. Refresh and try again.' : 'Could not change switch. Refresh and try again.'
    expect(page.render()).toContain(`<span role="alert">${message}</span>`)
    expect(onSaved).not.toHaveBeenCalled()
  }
})

it('uses an error toast for an operational plan-save failure', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'internal_error' }, { status: 503 }))
  const page = control(async () => {}, 'plan')
  page.select('plus'); await page.submit()
  expect(page.toasts.notice).toMatchObject({ message: 'Could not save. Refresh and try again.', tone: 'error' })
  expect(page.render()).not.toContain('<span role="alert">')
})
