import { afterEach, expect, it, vi } from 'vitest'
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import * as React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { ApiError, apiFetch, errorMessage } from './api'
import * as requests from './requests'
import * as contacts from './contacts'
import type { Item } from './items'

type Element = ReactElement<Record<string, unknown>>
type Kind = 'ask' | 'decision' | 'contact'
type MutationOptions = {
  mutationFn: (variables?: unknown) => Promise<unknown>
  onSuccess?: (data: unknown) => unknown
  onSettled?: () => unknown
}
const parent = 'c9c06db17817e6d49e5d5cfbbdd7f021ffcb3656'
const item: Item = {
  id: 'item', cache_id: 'cache', owner_id: 'owner', owner_name: 'Owner', title: 'Starter',
  description: null, is_consumable: true, quantity: 8, available_quantity: 3,
  available: true, unavailable_note: null, photo_version: null, created_at: 1,
}
const request: requests.ItemRequest = {
  id: 'request', cache_id: 'cache', cache_name: 'Tools', item_id: item.id, item_title: item.title,
  owner_id: 'owner', owner_name: 'Owner', requester_id: 'member', requester_name: 'Neighbor',
  quantity: 2, status: 'pending', decision_reason: null, approval_message: null, created_at: 1, decided_at: null,
}
const contact: contacts.Contact = { kind: 'email', value: 'chosen@example.test', link: 'mailto:chosen@example.test' }
const invalidations = ['item-requests', 'requests', 'item', 'items', 'library', 'library-item', 'home-summary', 'caches', 'cache', 'request-detail', 'request-contact']
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function descendants(children: ReactNode): Element[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement(child)) return []
    const node = child as Element
    return [node, ...descendants(node.props.children as ReactNode)]
  })
}
function text(node: Element): string {
  return Children.toArray(node.props.children as ReactNode).map(child => isValidElement(child) ? text(child as Element) : String(child)).join('')
}

function fixture(kind: Kind, options: { item?: Item; request?: requests.ItemRequest; callerId?: string } = {}) {
  const trace: unknown[][] = [], states: unknown[] = [], refs: { current: unknown }[] = []
  const effects: (() => void)[] = []
  const queryOptions: Record<string, unknown>[] = []
  let elements: Element[] = [], stateIndex = 0, refIndex = 0, mounted = false
  let lastMutation: Promise<void> = Promise.resolve(), focus = 'Ask trigger'
  let mutationOptions: MutationOptions
  const mutation = { pending: false, error: null as unknown, success: false }
  const currentItem = options.item ?? item, currentRequest = options.request ?? request
  const query = {
    data: kind === 'contact' ? { contact } : currentItem,
    isPending: false, isFetching: false, isError: false, isSuccess: true, error: null as unknown,
    refetch: vi.fn(async () => { trace.push(['refetch']) }),
  }
  const queryClient = {
    invalidateQueries: vi.fn(({ queryKey }: { queryKey: string[] }) => {
      trace.push(['invalidate', queryKey]); return Promise.resolve()
    }),
  }
  const mutationApi = {
    get isPending() { return mutation.pending }, get isError() { return !!mutation.error },
    get isSuccess() { return mutation.success }, get error() { return mutation.error },
    reset() { mutation.pending = false; mutation.error = null; mutation.success = false },
    mutate(variables?: unknown) {
      mutation.pending = true; mutation.error = null; mutation.success = false
      lastMutation = (async () => {
        try {
          const data = await mutationOptions.mutationFn(variables)
          await mutationOptions.onSuccess?.(data)
          mutation.success = true
        } catch (error) { mutation.error = error }
        finally { await mutationOptions.onSettled?.(); mutation.pending = false }
      })()
    },
  }
  const dialogModel = {
    open: false,
    showModal() {
      this.open = true
      const target = elements.find(node => node.props.autoFocus)
      focus = target?.props.id as string || (target ? text(target) : 'Close decision sheet')
      trace.push(['open'], ['focus', focus])
    },
    close() {
      this.open = false; trace.push(['close']); focus = 'Ask trigger'
      ;(dialog().props.onClose as () => void)?.()
    },
  }
  const cancelModel = { autofocus: false }
  const record = (factory: typeof jsx) => (...args: Parameters<typeof jsx>) => {
    const element = factory(...args)
    elements.push(element as Element)
    return element
  }
  const Null = () => null
  const modules: Record<string, unknown> = {
    react: {
      ...React,
      useState(initial: unknown) {
        const index = stateIndex++
        if (!(index in states)) states[index] = initial
        return [states[index], (value: unknown) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
      },
      useRef(initial: unknown) { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }) },
      useEffect(effect: () => void) { if (!mounted) effects.push(effect) },
    },
    'react/jsx-runtime': { jsx: record(jsx), jsxs: record(jsxs), Fragment: React.Fragment },
    '@tanstack/react-query': {
      useQueryClient: () => queryClient,
      useMutation(options: MutationOptions) { mutationOptions = options; return mutationApi },
      useQuery(options: Record<string, unknown>) { queryOptions.push(options); return query },
    },
    '../lib/api': { ApiError, apiFetch, errorMessage }, '../lib/requests': requests, '../lib/contacts': contacts,
    '../components/Cat': { Cat: Null }, '../components/Skeleton': { LoadingLines: ({ label }: { label: string }) => createElement('p', null, label) },
  }
  const file = kind === 'ask' ? 'AskSheet' : kind === 'decision' ? 'RequestDecision' : 'RequestContact'
  const source = process.env.REQUEST_CONTRACT_PARENT === '1'
    ? execFileSync('git', ['show', `${parent}:web/src/pages/${file}.tsx`], { encoding: 'utf8' })
    : readFileSync(new URL(`../pages/${file}.tsx`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const module = { exports: {} as Record<string, React.ComponentType<Record<string, unknown>>> }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected request dependency: ${name}`)
    return modules[name]
  }, module, module.exports)
  const Component = module.exports[kind === 'contact' ? 'ApprovedContact' : file]
  const props = kind === 'ask'
    ? { item: currentItem, cacheName: 'Tools', onClose: () => trace.push(['ask-closed']) }
    : { request: currentRequest, callerId: options.callerId ?? 'member', focused: true }
  function dialog() { return elements.find(node => node.type === 'dialog')! }
  function render() {
    elements = []; queryOptions.length = 0; stateIndex = 0; refIndex = 0
    const html = renderToStaticMarkup(createElement(Component, props))
    for (const node of elements.filter(node => node.type === 'dialog')) (node.props.ref as { current: unknown }).current = dialogModel
    for (const node of elements.filter(node => node.type === 'button' && node.props.ref)) (node.props.ref as { current: unknown }).current = cancelModel
    if (!mounted) { effects.forEach(effect => effect()); mounted = true }
    return html
  }
  function button(label: string) {
    const node = [...elements].reverse().find(node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label))
    if (!node) throw new Error(`Missing button: ${label}`)
    return node
  }
  function click(label: string) { (button(label).props.onClick as () => void)(); render() }
  function change(id: string, value: unknown) {
    const node = elements.find(node => node.props.id === id || node.props.role === id)!
    ;(node.props.onChange as (event: unknown) => void)({ target: { value, checked: value } }); render()
  }
  function submit() {
    const form = elements.find(node => node.type === 'form')!
    ;(form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() })
  }
  function escape() {
    const preventDefault = vi.fn()
    ;(dialog().props.onCancel as (event: unknown) => void)({ preventDefault })
    if (!preventDefault.mock.calls.length) dialogModel.close()
    return preventDefault
  }
  render()
  return {
    trace, render, button, click, change, submit, escape, query, queryOptions, queryClient, dialogModel, cancelModel,
    field: (id: string) => elements.find(node => node.props.id === id)!,
    buttons: () => descendants(dialog().props.children as ReactNode).filter(node => node.type === 'button'),
    settled: () => lastMutation, focus: () => focus,
  }
}

it('asks with native Cancel autofocus declared before showModal; idle Cancel/Escape dismiss without sending', () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  for (const action of ['Cancel', 'Escape']) {
    const page = fixture('ask')
    expect(page.cancelModel.autofocus).toBe(true)
    expect(page.button('Cancel').props.autoFocus).toBe(true)
    expect(page.focus()).toBe('Cancel')
    expect(page.dialogModel.open).toBe(true)
    if (action === 'Cancel') page.click('Cancel')
    else expect(page.escape()).not.toHaveBeenCalled()
    expect(page.dialogModel.open).toBe(false)
    expect(page.focus()).toBe('Ask trigger')
    expect(page.trace.at(-1)).toEqual(['ask-closed'])
  }
  expect(fetch).not.toHaveBeenCalled()
})

it('guards invalid, unavailable, fetching and failed-stock asks before the mutation', () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  const page = fixture('ask')
  for (const value of ['', '0', '1.5', '4', '10000']) {
    page.change('request-quantity', value)
    expect(page.button('Send ask').props.disabled).toBe(true)
    page.submit()
  }
  page.change('request-quantity', '2')
  for (const state of [{ isFetching: true }, { isError: true }]) {
    Object.assign(page.query, { isFetching: false, isError: false }, state); page.render()
    expect(page.button('Send ask').props.disabled).toBe(true); page.submit()
  }
  for (const stock of [{ ...item, available: false }, { ...item, available_quantity: 0 }, { ...item, available_quantity: undefined }]) {
    Object.assign(page.query, { isFetching: false, isError: false, data: stock }); page.render()
    expect(page.button('Send ask').props.disabled).toBe(true); page.submit()
  }
  expect(fetch).not.toHaveBeenCalled()
})

it('keeps ask query options, stepper bounds, pending Escape guard and exact numeric POST', async () => {
  let respond!: (response: Response) => void
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { respond = resolve }))
  const page = fixture('ask')
  expect(page.queryOptions[0]).toMatchObject({ queryKey: ['item', 'cache', 'item'], enabled: true })
  expect(page.field('request-quantity').props).toMatchObject({ min: 1, max: 3, step: 1, required: true })
  page.click('Increase ask quantity'); expect(page.field('request-quantity').props.value).toBe('2')
  page.click('Decrease ask quantity'); expect(page.field('request-quantity').props.value).toBe('1')
  page.change('request-quantity', '2'); page.submit(); page.render()
  expect(page.button('Sending ask…').props.disabled).toBe(true)
  expect(page.button('Cancel').props.disabled).toBe(true)
  expect(page.escape()).toHaveBeenCalledOnce()
  expect(page.dialogModel.open).toBe(true)
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/caches/cache/items/item/requests', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: '{"quantity":2}' }))
  respond(Response.json(request)); await page.settled()
  expect(page.trace.filter(row => row[0] === 'invalidate')).toEqual(invalidations.map(key => ['invalidate', [key]]))
  expect(page.render()).toContain('Ask sent')
  expect(page.button('Done').props.autoFocus).toBe(true)
  page.click('Done'); expect(page.dialogModel.open).toBe(false)
})

it('retains ask errors including limit_reached and stock race, invalidates on every outcome, and retries without closing', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ error: 'limit_reached', limit: 'open_requests' }, { status: 409 }))
    .mockResolvedValueOnce(Response.json({ error: 'insufficient_stock' }, { status: 409 }))
    .mockResolvedValueOnce(Response.json(request))
  const page = fixture('ask')
  page.change('request-quantity', '2')
  page.submit(); await page.settled()
  expect(page.render()).toContain('Limit reached: you have the maximum number of pending asks. Wait for one to be answered.')
  expect(page.dialogModel.open).toBe(true)
  page.submit(); await page.settled()
  expect(page.render()).toContain('There is not enough available stock. The item and requests have been refreshed.')
  expect(page.dialogModel.open).toBe(true)
  page.submit(); await page.settled(); expect(page.render()).toContain('Ask sent')
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(page.trace.filter(row => row[0] === 'invalidate')).toEqual(Array.from({ length: 3 }, () => invalidations.map(key => ['invalidate', [key]])).flat())
})

it('sends reusable asks with null quantity and keeps unknown-stock refresh retry query', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(request))
  const page = fixture('ask', { item: { ...item, is_consumable: false, quantity: null, available_quantity: null } })
  expect(page.render()).not.toContain('request-quantity')
  page.submit(); await page.settled()
  expect(fetch.mock.calls[0][1]?.body).toBe('{"quantity":null}')
  page.query.isError = true; page.query.error = new ApiError(503, 'internal_error')
  // A fresh sheet keeps the availability retry in the pre-submit form.
  const failed = fixture('ask')
  failed.query.isError = true; failed.query.error = page.query.error; failed.render()
  failed.click('Refresh availability'); expect(failed.query.refetch).toHaveBeenCalledOnce()
})

it('approval opens with empty message, default reusable Lent out on, and resets on reopen', () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  const page = fixture('decision', { request: { ...request, quantity: null } })
  page.click('Approve request from Neighbor')
  expect(page.field('approval-message-request').props.value).toBe('')
  expect(page.render()).not.toContain('private-auth@example.test')
  expect(page.buttons().find(node => node.props.type === 'submit')?.props.disabled).toBe(false)
  page.change('switch', false)
  expect(page.render()).not.toContain('Lent out note (optional)</label>')
  page.change('approval-message-request', 'old message')
  page.click('Close decision sheet')
  expect(page.dialogModel.open).toBe(false)
  expect(page.trace.filter(row => row[0] === 'invalidate')).toEqual(invalidations.map(key => ['invalidate', [key]]))
  page.click('Approve request from Neighbor')
  expect(page.field('approval-message-request').props.value).toBe('')
  expect(page.field('approval-note-request').props.value).toBe('')
  expect(fetch).not.toHaveBeenCalled()
})

it('counts approval message/note Unicode code points and preserves note edited vs untouched payloads', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ...request, status: 'approved' }))
  const page = fixture('decision', { request: { ...request, quantity: null } })
  page.click('Approve request from Neighbor')
  page.change('approval-message-request', '😀'.repeat(500))
  page.change('approval-note-request', '😀'.repeat(200))
  expect(page.button('Approve').props.disabled).toBe(false)
  page.change('approval-note-request', '😀'.repeat(201))
  expect(page.button('Approve').props.disabled).toBe(true)
  expect(page.render()).toContain('Keep the note within 200 characters.')
  page.change('approval-note-request', '  With a neighbor  ')
  page.change('approval-message-request', '😀'.repeat(501))
  expect(page.button('Approve').props.disabled).toBe(true)
  page.change('approval-message-request', '  See you soon  ')
  page.trace.length = 0; page.submit(); await page.settled()
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({ approval_message: 'See you soon', mark_lent_out: true, unavailable_note: 'With a neighbor' })
  expect(page.trace).toEqual([['close'], ...invalidations.map(key => ['invalidate', [key]])])
  page.click('Approve request from Neighbor'); page.submit(); await page.settled()
  expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({ approval_message: '', mark_lent_out: true })
  page.click('Approve request from Neighbor'); page.change('approval-note-request', '  '); page.submit(); await page.settled()
  expect(JSON.parse(fetch.mock.calls[2][1]?.body as string)).toEqual({ approval_message: '', mark_lent_out: true, unavailable_note: null })
})

it('keeps consumable approval free of Lent out controls and blocks pending sheet close/Escape', async () => {
  let respond!: (response: Response) => void
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { respond = resolve }))
  const page = fixture('decision')
  page.click('Approve request from Neighbor')
  expect(page.render()).not.toContain('Mark as lent out')
  page.submit(); page.render()
  expect(page.buttons().every(button => button.props.disabled)).toBe(true)
  expect(page.escape()).toHaveBeenCalledOnce()
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/me/requests/request/approve', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: '{"approval_message":"","mark_lent_out":false}' }))
  respond(Response.json({ error: 'request_not_pending' }, { status: 409 })); await page.settled()
  expect(page.render()).toContain('This ask has already been decided. Close this sheet to refresh the list.')
  expect(page.dialogModel.open).toBe(true)
  expect(page.queryClient.invalidateQueries).not.toHaveBeenCalled()
  expect(page.escape()).not.toHaveBeenCalled()
  expect(page.dialogModel.open).toBe(false)
  expect(page.trace.filter(row => row[0] === 'invalidate')).toEqual(invalidations.map(key => ['invalidate', [key]]))
})

it('requires a decline reason, keeps autofocus and mode changes, and posts only the trimmed reason', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ...request, status: 'rejected' }))
  const page = fixture('decision')
  page.click('Decline request from Neighbor')
  expect(page.field('decline-reason-request').props).toMatchObject({ autoFocus: true, required: true, value: '' })
  expect(page.button('Decline ask').props.disabled).toBe(true)
  page.change('decline-reason-request', '😀'.repeat(501))
  expect(page.button('Decline ask').props.disabled).toBe(true)
  page.change('decline-reason-request', '  Not today  ')
  page.click('Back to approval'); page.click('Decline with a reason')
  expect(page.field('decline-reason-request').props.value).toBe('  Not today  ')
  page.submit(); await page.settled()
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/me/requests/request/reject', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: '{"reason":"Not today"}' }))
  expect(page.dialogModel.open).toBe(false)
  expect(page.trace.filter(row => row[0] === 'invalidate')).toEqual(invalidations.map(key => ['invalidate', [key]]))
})

it('never enables or reveals contacts for pending/rejected requests or non-parties', () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  for (const status of ['pending', 'rejected', 'approved'] as const) {
    for (const callerId of ['member', 'owner', 'third']) {
      if (status === 'approved' && callerId !== 'third') continue
      const page = fixture('contact', { request: { ...request, status }, callerId })
      expect(page.queryOptions[0]).toMatchObject({ queryKey: ['request-contact', callerId, request.id], enabled: false, retry: false, gcTime: 0 })
      expect(page.render()).toBe('')
    }
  }
  expect(fetch).not.toHaveBeenCalled()
})

it('reveals only API-approved contact, hides stale data while fetching/denied and preserves exact retry read', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ contact }))
  const page = fixture('contact', { request: { ...request, status: 'approved' } })
  expect(page.queryOptions[0]).toMatchObject({ queryKey: ['request-contact', 'member', request.id], enabled: true, retry: false, gcTime: 0 })
  await (page.queryOptions[0].queryFn as () => Promise<unknown>)()
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/me/requests/request/contact', expect.objectContaining({ method: 'GET', credentials: 'same-origin', body: undefined }))
  expect(page.render()).toContain('href="mailto:chosen@example.test"')
  expect(page.render()).not.toContain('private-auth@example.test')
  page.query.isFetching = true
  expect(page.render()).toContain('Loading contact…')
  expect(page.render()).not.toContain('chosen@example.test')
  page.query.isFetching = false; page.query.isError = true; page.query.error = new ApiError(404, 'not_found')
  expect(page.render()).toContain('Contact is unavailable')
  expect(page.render()).not.toContain('chosen@example.test')
  page.click('Try contact again'); expect(page.query.refetch).toHaveBeenCalledOnce()
  page.query.isError = false; page.query.data = { contact: null } as unknown as typeof page.query.data
  expect(page.render()).toContain('hasn&#x27;t added a way to reach them yet')
})
