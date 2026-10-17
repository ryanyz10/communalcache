import { afterEach, expect, it, vi } from 'vitest'
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import * as React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import * as Router from 'react-router'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { apiFetch, errorMessage } from './api'
import * as items from './items'
import { cacheDetailQuery } from './caches'
import { PHOTO_READ_ERROR, uploadPhoto } from './photos'
import { invalidateRequestViews } from './requests'

type Element = ReactElement<Record<string, unknown>>
type Kind = 'delete' | 'sharing' | 'form' | 'photo'
type MutationOptions = {
  mutationFn: (variables?: unknown) => Promise<unknown>
  onSuccess?: (data: unknown, variables?: unknown) => unknown
  onSettled?: () => unknown
}
const parent = '82692d32909d4d63b4f3256c3e667c03e258707e'
const cacheA = { id: '11111111-1111-4111-8111-111111111111', name: 'Tools' }
const cacheB = { id: '22222222-2222-4222-8222-222222222222', name: 'Garden' }
const item: items.LibraryItem = {
  id: '33333333-3333-4333-8333-333333333333', cache_id: null, owner_id: 'owner', owner_name: 'Owner',
  title: 'Tent', description: null, is_consumable: false, quantity: null, available: true,
  created_at: 1, photo_version: null, caches: [cacheA, cacheB], pending_count: 0,
}
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
function click(node: Element) { (node.props.onClick as () => void)() }

function fixture(kind: Kind, context: { cacheId?: string; editing?: boolean } = {}) {
  const trace: unknown[][] = []
  const states: unknown[] = [], refs: { current: unknown }[] = []
  const mutations: { options: MutationOptions; pending: boolean; error: unknown; success: boolean; api: object }[] = []
  let elements: Element[] = [], stateIndex = 0, refIndex = 0, mutationIndex = 0
  let lastMutation: Promise<void> = Promise.resolve()
  let libraryItem = { ...item, caches: [...item.caches] }
  let focus = ''
  const photo = new Blob(['resized jpeg'], { type: 'image/jpeg' })
  const resizePhoto = vi.fn(async (_file: File) => photo)
  const label = kind === 'delete' ? 'delete-item-heading' : 'detach-item-heading'
  const dialogModel = {
    open: false,
    showModal() { this.open = true; focus = buttons().find(button => button.props.autoFocus)?.props.children as string; trace.push(['open', label], ['focus', focus]) },
    close() { this.open = false; trace.push(['close', label]) },
  }
  const inputModel = { value: 'selected-photo.png' }
  const queryClient = {
    invalidateQueries: vi.fn(({ queryKey }: { queryKey: unknown[] }) => { trace.push(['invalidate', queryKey]); return Promise.resolve() }),
    removeQueries: vi.fn(({ queryKey }: { queryKey: unknown[] }) => { trace.push(['remove', queryKey]) }),
    setQueryData: vi.fn((key: unknown[], update: unknown) => {
      if (typeof update === 'function') libraryItem = update(libraryItem)
      trace.push(['set', key, typeof update === 'function' ? libraryItem.caches.map(cache => cache.id) : update])
    }),
  }
  const useMutation = (options: MutationOptions) => {
    const index = mutationIndex++
    if (!mutations[index]) {
      const entry = { options, pending: false, error: null as unknown, success: false, api: {} }
      entry.api = {
        get isPending() { return entry.pending }, get isError() { return !!entry.error },
        get isSuccess() { return entry.success }, get error() { return entry.error },
        reset() { entry.pending = false; entry.error = null; entry.success = false },
        mutate(variables?: unknown) {
          entry.pending = true; entry.error = null; entry.success = false
          lastMutation = (async () => {
            try {
              const data = await entry.options.mutationFn(variables)
              await entry.options.onSuccess?.(data, variables)
              entry.success = true
            } catch (error) { entry.error = error }
            finally { await entry.options.onSettled?.(); entry.pending = false }
          })()
        },
      }
      mutations[index] = entry
    }
    mutations[index].options = options
    return mutations[index].api
  }
  const record = (factory: typeof jsx) => (...args: Parameters<typeof jsx>) => {
    const element = factory(...args)
    elements.push(element as Element)
    return element
  }
  const Null = () => null
  const currentItem = { ...item, cache_id: context.cacheId ?? null }
  const modules: Record<string, unknown> = {
    react: {
      ...React, useEffect: () => {},
      useState(initial: unknown) {
        const index = stateIndex++
        if (!(index in states)) states[index] = initial
        return [states[index], (value: unknown) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
      },
      useRef(initial: unknown) { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }) },
    },
    'react/jsx-runtime': { jsx: record(jsx), jsxs: record(jsxs), Fragment: React.Fragment },
    'react-router': {
      ...Router, useParams: () => ({ itemId: item.id, cacheId: context.cacheId }), useLocation: () => ({ hash: '' }),
      useNavigate: () => (...args: unknown[]) => trace.push(['navigate', ...args]),
    },
    '@tanstack/react-query': {
      useMutation, useQueryClient: () => queryClient,
      useQuery: ({ queryKey }: { queryKey: string[] }) => ({
        data: queryKey[0] === 'caches' ? [cacheA, cacheB] : queryKey[0] === 'cache' ? { ...cacheA, owner_id: 'owner' } : queryKey[0] === 'library-item' ? libraryItem : currentItem,
        error: null, isPending: false, isError: false, isSuccess: true,
      }),
    },
    '../auth/AuthProvider': { useAuth: () => ({ me: { id: 'owner', display_name: 'Owner' } }) },
    '../lib/api': { apiFetch, errorMessage }, '../lib/items': items, '../lib/caches': { cacheDetailQuery },
    '../lib/photos': { PHOTO_READ_ERROR, resizePhoto, uploadPhoto }, '../lib/requests': { invalidateRequestViews },
    './OnboardingPage': { OnboardingPage: Null }, './ItemPhoto': { ItemPhoto: Null, PhotoUpload: Null },
    './RequestsPage': { ItemRequests: Null }, './ItemForm': { ItemForm: Null }, './ShownIn': { ShownIn: Null },
    '../components/Avatar': { Avatar: Null }, '../components/Cat': { Cat: Null },
    '../components/Stamp': { Stamp: ({ children }: { children: ReactNode }) => createElement('span', null, children) },
    '../components/Box': { boxColor: () => '#f6a06b' }, '../components/ThingTile': { thingTone: () => 'clay' },
    '../components/Skeleton': { LoadingStatus: Null, Shimmer: Null, SkeletonRows: Null },
    '../components/skeletons/ItemSkeletons': { ItemSkeleton: Null, ItemEditorSkeleton: Null },
  }
  const oldFile = kind === 'delete' ? 'ItemPages' : kind === 'sharing' ? 'ShownIn' : kind === 'form' ? 'ItemForm' : 'ItemPhoto'
  const newFile = kind === 'delete' ? 'ItemPage' : oldFile
  const source = process.env.ITEM_CONTRACT_PARENT === '1'
    ? execFileSync('git', ['show', `${parent}:web/src/pages/${oldFile}.tsx`], { encoding: 'utf8' })
    : readFileSync(new URL(`../pages/${newFile}.tsx`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const module = { exports: {} as Record<string, (props: unknown) => ReactElement> }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected item dependency: ${name}`)
    return modules[name]
  }, module, module.exports)
  const component = module.exports[kind === 'delete' ? 'ItemPage' : kind === 'sharing' ? 'ShownIn' : kind === 'form' ? 'ItemForm' : 'PhotoUpload']
  const props = kind === 'form' ? {
    cacheId: context.cacheId ?? null, item: context.editing ? item : undefined,
    onSaved: (saved: items.Item) => trace.push(['saved', saved.id]), onCancel: () => trace.push(['cancel']),
    onBusy: (busy: boolean) => trace.push(['busy', busy]),
  } : kind === 'delete' ? {} : { item: currentItem }
  function render() {
    elements = []; stateIndex = 0; refIndex = 0; mutationIndex = 0
    const html = renderToStaticMarkup(createElement(Router.MemoryRouter, null, createElement(component as React.ComponentType<Record<string, unknown>>, props)))
    for (const node of elements.filter(node => node.type === 'dialog')) (node.props.ref as { current: unknown }).current = dialogModel
    for (const node of elements.filter(node => node.type === 'input' && node.props.ref)) (node.props.ref as { current: unknown }).current = inputModel
    return html
  }
  function dialog() { return elements.find(node => node.type === 'dialog' && node.props['aria-labelledby'] === label)! }
  function buttons() { return descendants(dialog().props.children as ReactNode).filter(node => node.type === 'button') }
  function change(id: string, value: unknown) {
    const node = elements.find(node => node.props.id === id)!
    ;(node.props.onChange as (event: unknown) => void)({ target: id.includes('photo') ? { files: [value] } : { value } })
    render()
  }
  function selectCache(id: string, checked: boolean) {
    const field = elements.find(node => node.type === 'fieldset' && node.props.className === 'cc-put-it-in')!
    const option = descendants(field.props.children as ReactNode).find(node => node.type === 'label' && text(node).includes(id === cacheA.id ? cacheA.name : cacheB.name))!
    const checkbox = descendants(option.props.children as ReactNode).find(node => node.type === 'input')!
    ;(checkbox.props.onChange as (event: unknown) => void)({ target: { checked } }); render()
  }
  function open() {
    if (kind === 'delete') click(elements.find(node => node.type === 'button' && text(node) === 'Delete item')!)
    else {
      const checkbox = elements.find(node => node.type === 'input' && node.props.type === 'checkbox')!
      ;(checkbox.props.onChange as (event: unknown) => void)({ target: { checked: false } })
    }
    render()
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
    trace, render, open, submit, escape, change, selectCache, resizePhoto, inputModel, dialogModel, buttons,
    settled: () => lastMutation, focus: () => focus, libraryItem: () => libraryItem,
    cancel: () => click(buttons()[0]), confirm: () => click(buttons()[1]),
    button: (label: string) => elements.find(node => node.type === 'button' && text(node) === label)!,
  }
}

for (const kind of ['delete', 'sharing'] as const) {
  it(`${kind} keeps safe Cancel focus and idle Cancel/Escape without a request`, () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const page = fixture(kind, { cacheId: cacheA.id })
    page.open(); expect(page.buttons()[0].props.autoFocus).toBe(true); expect(page.focus()).toBe('Cancel')
    page.cancel(); expect(page.dialogModel.open).toBe(false)
    page.open(); expect(page.escape()).not.toHaveBeenCalled(); expect(page.dialogModel.open).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it(`${kind} retains errors, guards pending Escape and sends the same private DELETE`, async () => {
    let respond!: (response: Response) => void
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { respond = resolve }))
    const page = fixture(kind, { cacheId: cacheA.id })
    page.open(); page.confirm(); page.render()
    expect(page.buttons().every(button => button.props.disabled)).toBe(true)
    expect(page.escape()).toHaveBeenCalledOnce(); expect(page.dialogModel.open).toBe(true)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/me/items/${item.id}${kind === 'sharing' ? `/attachments/${cacheA.id}` : ''}`, expect.objectContaining({ method: 'DELETE', body: undefined, credentials: 'same-origin' }))
    respond(Response.json({ error: 'not_found' }, { status: 404 })); await page.settled()
    expect(page.render()).toContain('This cache, item or invite is not available, or you are no longer a member.')
    expect(page.dialogModel.open).toBe(true)
  })

  it(`${kind} preserves success pointer/close/navigation/removal/invalidation order`, async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const page = fixture(kind, { cacheId: cacheA.id })
    page.open(); page.trace.length = 0; page.confirm(); await page.settled()
    const expected: unknown[][] = kind === 'delete'
      ? [['close', 'delete-item-heading'], ['navigate', '/items'], ...['item', 'library-item', 'item-requests'].map(key => ['remove', [key]])]
      : [['set', ['library-item', 'owner', item.id], [cacheB.id]], ['close', 'detach-item-heading'], ['navigate', `/items/${item.id}`, { replace: true }]]
    expected.push(...invalidations.map(key => ['invalidate', [key]]))
    expect(page.trace).toEqual(expected)
    expect(page.dialogModel.open).toBe(false)
  })
}

it('preserves save→failed photo→photo retry→partial sharing→sharing retry without duplicate create/upload', async () => {
  let photoAttempts = 0, shareAttempts = 0
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, init) => {
    if (path === '/api/me/items') return Response.json(item)
    if (String(path).endsWith('/photo')) return ++photoAttempts === 1 ? Response.json({ error: 'invalid_photo' }, { status: 400 }) : Response.json({ ...item, photo_version: 'uploaded' })
    if (String(path).endsWith(`/attachments/${cacheB.id}`) && ++shareAttempts === 1) return Response.json({ error: 'not_found' }, { status: 404 })
    expect(init?.method).toBe('PUT'); return new Response(null, { status: 204 })
  })
  const page = fixture('form')
  page.change('item-title', 'Tent'); page.change('new-item-photo', new File(['png'], 'photo.png', { type: 'image/png' }))
  page.selectCache(cacheA.id, true); page.selectCache(cacheB.id, true)
  page.submit(); await page.settled()
  expect(page.render()).toContain('Retry photo')
  expect(page.render()).toContain('<fieldset disabled="" class="cc-item-fields"')
  page.submit(); await page.settled(); expect(page.render()).toContain('Retry sharing')
  expect(page.render()).toContain('Garden. Already shared caches are kept.')
  page.submit(); await page.settled()
  expect(fetch.mock.calls.map(call => call[0])).toEqual([
    '/api/me/items', `/api/me/items/${item.id}/photo`, `/api/me/items/${item.id}/photo`,
    `/api/me/items/${item.id}/attachments/${cacheA.id}`, `/api/me/items/${item.id}/attachments/${cacheB.id}`, `/api/me/items/${item.id}/attachments/${cacheB.id}`,
  ])
  expect(page.resizePhoto).toHaveBeenCalledTimes(2)
  expect(page.trace.filter(row => row[0] === 'saved')).toEqual([['saved', item.id]])
  expect(page.trace.slice(-13)).toEqual([['saved', item.id], ['busy', false], ...invalidations.map(key => ['invalidate', [key]])])
})

it('keeps decode failure before create, explicit Continue without photo and Keep without remaining shares', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async path => path === '/api/me/items' ? Response.json(item) : Response.json({ error: 'not_found' }, { status: 404 }))
  const page = fixture('form')
  page.change('item-title', 'Tent'); page.change('new-item-photo', new File(['png'], 'photo.png', { type: 'image/png' }))
  page.selectCache(cacheA.id, true)
  page.resizePhoto.mockRejectedValueOnce(new Error(PHOTO_READ_ERROR))
  page.submit(); await page.settled(); expect(fetch).not.toHaveBeenCalled()
  expect(page.render()).toContain("Couldn&#x27;t read that image, try another.")
  page.submit(); await page.settled(); expect(page.render()).toContain('Retry photo')
  click(page.button('Continue without photo')); await page.settled()
  expect(page.render()).toContain('Keep item without remaining shares')
  click(page.button('Keep item without remaining shares'))
  expect(fetch.mock.calls.filter(call => call[0] === '/api/me/items')).toHaveLength(1)
  expect(fetch.mock.calls.filter(call => String(call[0]).endsWith('/photo'))).toHaveLength(1)
  expect(page.trace.filter(row => row[0] === 'saved')).toEqual([['saved', item.id]])
})

it('retains atomic cache creation/first attachment, and editing PATCH omits immutable type', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/attachments/'+cacheB.id) ? new Response(null, { status: 204 }) : Response.json(item))
  const creating = fixture('form', { cacheId: cacheA.id })
  creating.change('item-title', 'Tent'); creating.selectCache(cacheB.id, true); creating.submit(); await creating.settled()
  expect(fetch.mock.calls.map(call => call[0])).toEqual([`/api/caches/${cacheA.id}/items`, `/api/me/items/${item.id}/attachments/${cacheB.id}`])
  const editing = fixture('form', { editing: true })
  editing.change('item-title', 'Updated'); editing.submit(); await editing.settled()
  const call = fetch.mock.calls.at(-1)!
  expect(call[0]).toBe(`/api/me/items/${item.id}`)
  expect(call[1]?.method).toBe('PATCH')
  expect(JSON.parse(call[1]?.body as string)).not.toHaveProperty('is_consumable')
})

it('photo upload failure retains selection, then retry updates cache data before invalidation and clears the file', async () => {
  const saved = { ...item, photo_version: 'photo-version' }
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ error: 'invalid_photo' }, { status: 400 })).mockResolvedValueOnce(Response.json(saved))
  const page = fixture('photo', { cacheId: cacheA.id })
  page.change('item-photo', new File(['png'], 'photo.png', { type: 'image/png' }))
  page.submit(); await page.settled(); expect(page.inputModel.value).toBe('selected-photo.png')
  page.trace.length = 0; page.submit(); await page.settled()
  expect(fetch.mock.calls.map(call => call[0])).toEqual(Array(2).fill(`/api/caches/${cacheA.id}/items/${item.id}/photo`))
  expect(page.trace).toEqual([['set', ['item', cacheA.id, item.id], saved], ...invalidations.map(key => ['invalidate', [key]])])
  expect(page.inputModel.value).toBe('')
})
