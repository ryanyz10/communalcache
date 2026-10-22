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
import { toastFixture } from '../test/toastFixture'

type Element = ReactElement<Record<string, unknown>>
type Kind = 'delete' | 'sharing' | 'form' | 'add' | 'availability'
type MutationOptions = {
  mutationFn: (variables?: unknown) => Promise<unknown>
  onSuccess?: (data: unknown, variables?: unknown) => unknown
  onError?: (error: unknown, variables?: unknown) => unknown
  onSettled?: () => unknown
}
const parent = '82692d32909d4d63b4f3256c3e667c03e258707e'
const cacheA = { id: '11111111-1111-4111-8111-111111111111', name: 'Tools' }
const cacheB = { id: '22222222-2222-4222-8222-222222222222', name: 'Garden' }
const cacheC = { id: '44444444-4444-4444-8444-444444444444', name: 'Club' }
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

function fixture(kind: Kind, context: { cacheId?: string; editing?: boolean; sharingLoading?: boolean; available?: boolean; active?: boolean; pendingCount?: number; photoVersion?: string } = {}) {
  const toasts = toastFixture()
  const trace: unknown[][] = []
  const states: unknown[] = [], refs: { current: unknown }[] = []
  const mutations: { options: MutationOptions; pending: boolean; error: unknown; success: boolean; api: object }[] = []
  const effects: {dependencies: unknown[]; cleanup?: () => void}[] = []
  let pendingEffects: (() => void)[] = [], effectIndex = 0
  let editorState = {dirty:false,committed:false}
  let sharedResult: boolean | undefined
  let elements: Element[] = [], stateIndex = 0, refIndex = 0, mutationIndex = 0
  let lastMutation: Promise<void> = Promise.resolve()
  let libraryItem = { ...item, active:context.active ?? true, photo_version:context.photoVersion ?? null, pending_count:context.pendingCount ?? 0, caches: [...item.caches] }
  let focus = ''
  const photo = new Blob(['resized jpeg'], { type: 'image/jpeg' })
  const resizePhoto = vi.fn(async (_file: File) => photo)
  const label = kind === 'delete' ? 'delete-item-heading' : kind === 'add' ? 'add-items-heading' : 'detach-item-heading'
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
            } catch (error) { entry.error = error; await entry.options.onError?.(error, variables) }
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
  const currentItem = { ...item, cache_id: context.cacheId ?? null, available: context.available ?? true, active:context.active ?? true, photo_version:context.photoVersion ?? null }
  const modules: Record<string, unknown> = {
    ...toasts.modules,
    react: {
      ...React,
      useEffect(effect: () => (() => void) | void, dependencies: unknown[]) {
        const index = effectIndex++, previous = effects[index]
        if (previous && dependencies.every((value, slot) => Object.is(value, previous.dependencies[slot]))) return
        pendingEffects.push(() => { previous?.cleanup?.(); effects[index] = {dependencies,cleanup:effect() ?? undefined} })
      },
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
        data: queryKey[0] === 'caches' ? [cacheA, cacheB, cacheC] : queryKey[0] === 'cache' ? { ...cacheA, owner_id: 'owner' } : queryKey[0] === 'library-item' ? context.sharingLoading ? undefined : libraryItem : currentItem,
        error: null, isPending: queryKey[0] === 'library-item' && !!context.sharingLoading, isError: false, isSuccess: queryKey[0] !== 'library-item' || !context.sharingLoading,
      }),
    },
    '../auth/AuthProvider': { useAuth: () => ({ me: { id: 'owner', display_name: 'Owner' } }) },
    '../lib/api': { apiFetch, errorMessage }, '../lib/items': { ...items, useLibrary: () => ({ data: { pages: [{ items: [item, {...item,id:'unshared',title:'Ladder',caches:[]}, {...item,id:'other',title:'Tarp',caches:[]}] }] }, isSuccess:true }) }, '../lib/caches': { cacheDetailQuery },
    '../lib/photos': { PHOTO_READ_ERROR, resizePhoto, uploadPhoto }, '../lib/requests': { invalidateRequestViews },
    './OnboardingPage': { OnboardingPage: Null }, './ItemPhoto': { ItemPhoto: Null },
    './RequestsPage': { ItemRequests: Null }, './ItemRequests': { ItemRequests: Null }, './ItemForm': { ItemForm: Null }, './ShownIn': { ShownIn: Null },
    './ItemWaiting': { ItemWaiting: Null }, './DeleteItem': { DeleteItem: Null },
    '../components/Avatar': { Avatar: Null }, '../components/Cat': { Cat: Null },
    '../components/PhotoPreview': { PhotoPreview: Null },
    '../components/Stamp': { Stamp: ({ children }: { children: ReactNode }) => createElement('span', null, children) },
    '../components/Box': { boxColor: () => '#f6a06b' }, '../components/ThingTile': { thingTone: () => 'clay' },
    '../components/Skeleton': { LoadingStatus: Null, Shimmer: Null, SkeletonRows: Null },
    '../components/skeletons/ItemSkeletons': { ItemSkeleton: Null, ItemEditorSkeleton: Null },
  }
  const hook = { exports: {} }
  const hookSource = readFileSync(new URL('./usePhotoSelection.ts', import.meta.url), 'utf8')
  const hookCompiled = ts.transpileModule(hookSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', hookCompiled)((name: string) => name === 'react' ? modules.react : { resizePhoto }, hook, hook.exports)
  modules['../lib/usePhotoSelection'] = hook.exports
  const oldFile = kind === 'delete' || kind === 'availability' ? 'ItemPages' : kind === 'sharing' ? 'ShownIn' : kind === 'form' ? 'ItemForm' : 'AddItemSheet'
  const newFile = kind === 'delete' ? 'DeleteItem' : kind === 'availability' ? 'ItemPage' : oldFile
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
  const component = module.exports[kind === 'delete' ? 'DeleteItem' : kind === 'availability' ? 'ItemAvailability' : kind === 'sharing' ? 'ShownIn' : kind === 'form' ? 'ItemForm' : 'AddItemSheet']
  const props = kind === 'form' ? {
    cacheId: context.cacheId ?? null, item: context.editing ? currentItem : undefined,
    onStateChange: (state: typeof editorState) => { editorState = state },
    onSaved: (saved: items.Item, shared?: boolean) => { sharedResult = shared; trace.push(['saved', saved.id]) }, onCancel: () => trace.push(['cancel']),
    onBusy: (busy: boolean) => trace.push(['busy', busy]),
  } : kind === 'add' ? { cacheId: cacheA.id, cacheName: cacheA.name, dialog: {current: dialogModel} } : { item: currentItem }
  function render() {
    elements = []; stateIndex = 0; refIndex = 0; mutationIndex = 0; effectIndex = 0; pendingEffects = []
    const html = renderToStaticMarkup(createElement(Router.MemoryRouter, null, createElement(React.Fragment, null, createElement(component as React.ComponentType<Record<string, unknown>>, props), toasts.element())))
    for (const node of elements.filter(node => node.type === 'dialog')) (node.props.ref as { current: unknown }).current = dialogModel
    for (const node of elements.filter(node => node.type === 'input' && node.props.ref)) (node.props.ref as { current: unknown }).current = inputModel
    pendingEffects.forEach(effect => effect())
    return html
  }
  function dialog() { return elements.find(node => node.type === 'dialog' && node.props['aria-labelledby'] === label)! }
  function buttons() { return descendants(dialog().props.children as ReactNode).filter(node => node.type === 'button') }
  function change(id: string, value: unknown) {
    const node = elements.find(node => node.props.id === id)!
    ;(node.props.onChange as (event: unknown) => void)({ target: id.includes('photo') ? { files: [value] } : id === 'item-active' ? {checked:value} : { value } })
    render()
  }
  function selectCache(id: string, checked: boolean) {
    const name = [cacheA,cacheB,cacheC].find(cache => cache.id === id)!.name
    const option = elements.find(node => node.type === 'button' && node.props.className === 'cc-select-pill' && text(node).startsWith(name))!
    if (!option.props.disabled && option.props['aria-pressed'] !== checked) click(option)
    render()
  }
  function open() {
    if (kind === 'delete') click(elements.find(node => node.type === 'button' && text(node) === 'Delete item')!)
    else {
      selectCache(cacheA.id, false)
      submit()
    }
    render()
  }
  function submit() {
    const form = elements.find(node => node.type === 'form')!
    ;(form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() })
  }
  function escape() {
    const preventDefault = vi.fn()
    ;(dialog().props.onCancel as (event: unknown) => void)({ preventDefault, stopPropagation:vi.fn() })
    if (!preventDefault.mock.calls.length) dialogModel.close()
    return preventDefault
  }
  render()
  return {
    toasts, trace, render, open, submit, escape, change, selectCache, resizePhoto, inputModel, dialogModel, buttons,
    settled: () => lastMutation, focus: () => focus, libraryItem: () => libraryItem,
    async prepared() { for (let index = 0; index < 5; index++) await Promise.resolve(); return render() },
    preview: () => elements.find(node => String(node.props.alt).startsWith('Selected'))!,
    recoveryActions: () => elements.find(node => node.props.className === 'cc-item-recovery-actions'),
    editorState: () => editorState,
    sharedInCurrentCache: () => sharedResult,
    setAvailability(available: boolean) { currentItem.available = available; render() },
    setPhotoVersion(version: string) { currentItem.photo_version=version; libraryItem.photo_version=version; render() },
    cancel: () => click(buttons()[0]), confirm: () => click(buttons()[1]),
    row: (title: string) => elements.find(node => node.type === 'button' && node.props.className === 'cc-select-row' && text(node).startsWith(title))!,
    button: (label: string) => elements.find(node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label))!,
  }
}

for (const kind of ['delete'] as const) {
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
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/me/items/${item.id}`, expect.objectContaining({ method: 'DELETE', body: undefined, credentials: 'same-origin' }))
    respond(Response.json({ error: 'not_found' }, { status: 404 })); await page.settled()
    expect(page.render()).toContain('This cache, item or invite is not available, or you are no longer a member.')
    expect(page.dialogModel.open).toBe(true)
  })

  it(`${kind} preserves success pointer/close/navigation/removal/invalidation order`, async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const page = fixture(kind, { cacheId: cacheA.id })
    page.open(); page.trace.length = 0; page.confirm(); await page.settled()
    const expected: unknown[][] = [['close', 'delete-item-heading'], ['navigate', '/items', {replace:true}], ...['item', 'library-item', 'item-requests'].map(key => ['remove', [key]])]
    expected.push(...invalidations.map(key => ['invalidate', [key]]))
    expect(page.trace).toEqual(expected)
    expect(page.dialogModel.open).toBe(false)
  })
}

it('availability is one immediate button with exact boolean PATCH, pending disabling and both success labels', async () => {
  let respond!: (response:Response) => void
  const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(() => new Promise(resolve => {respond=resolve}))
  const page = fixture('availability')
  expect(page.render()).toContain('role="status">Available')
  expect(page.render().match(/<button/g)).toHaveLength(1)
  expect(page.render()).not.toMatch(/<input|<form|Save availability|unavailable-note/)
  click(page.button('Mark as lent out'));page.render()
  expect(page.button('Saving…').props.disabled).toBe(true)
  expect(fetch).toHaveBeenLastCalledWith(`/api/me/items/${item.id}`,expect.objectContaining({method:'PATCH',body:'{"available":false}'}))
  respond(Response.json({...item,available:false}));await page.settled();page.setAvailability(false)
  expect(page.toasts.notice).toMatchObject({message:'Marked as lent out',tone:'success'})
  expect(page.render()).toContain('role="status">Lent out')
  click(page.button('Mark as available'));page.render()
  expect(fetch).toHaveBeenLastCalledWith(`/api/me/items/${item.id}`,expect.objectContaining({method:'PATCH',body:'{"available":true}'}))
  respond(Response.json({...item,available:true}));await page.settled();page.setAvailability(true)
  expect(page.toasts.notice).toMatchObject({message:'Marked as available',tone:'success'})
  expect(page.button('Mark as lent out').props.disabled).toBe(false)
})

it('availability failure toasts without flipping the saved state and permits a manual retry', async () => {
  const fetch = vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(Response.json({error:'internal_error'},{status:503})).mockResolvedValueOnce(Response.json({...item,available:false}))
  const page = fixture('availability')
  click(page.button('Mark as lent out'));await page.settled();page.render()
  expect(page.toasts.notice).toMatchObject({tone:'error'})
  expect(page.button('Mark as lent out').props.disabled).toBe(false)
  click(page.button('Mark as lent out'));await page.settled()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('item overview lists only saved cache links, with no sharing controls', () => {
  const fetch = vi.spyOn(globalThis,'fetch'), page = fixture('sharing')
  const html = page.render()
  expect(html).toContain(`href="/caches/${cacheA.id}"`)
  expect(html).toContain(`href="/caches/${cacheB.id}"`)
  expect(html).not.toMatch(/<button|aria-pressed|<dialog/)
  expect(html).toContain('>In caches</h2>')
  expect(fetch).not.toHaveBeenCalled()
})

it('Active/Inactive is a local editor draft with state-specific copy and no request until Save', async () => {
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({...item,active:false}))
  const page=fixture('form',{editing:true})
  expect(page.render()).toContain('Item is shown in all attached caches')
  expect(page.editorState().dirty).toBe(false)
  page.change('item-active',false)
  expect(page.render()).toContain('aria-label="Inactive"')
  expect(page.render()).toContain('Item is hidden from all caches')
  expect(page.editorState().dirty).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
  page.submit();await page.settled()
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({active:false})
  expect(page.sharedInCurrentCache()).toBe(false)
})

it('Save confirms all-cache waiting declines before any write; Keep active restores the switch', async () => {
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({...item,active:false}))
  const page=fixture('form',{editing:true,pendingCount:2,cacheId:cacheA.id})
  page.change('item-active',false);page.submit();page.render()
  expect(page.dialogModel.open).toBe(true)
  expect(page.render()).toContain('Make Tent inactive?')
  expect(page.render()).toContain('It disappears from Tools and Garden. <strong>2 waiting requests will be declined.</strong>')
  expect(page.buttons().map(text)).toEqual(['Keep active','Make inactive'])
  expect(fetch).not.toHaveBeenCalled()
  page.cancel();page.render()
  expect(page.render()).toContain('aria-label="Active"')
  page.change('item-active',false);page.submit();page.render();page.confirm();await page.settled()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(page.sharedInCurrentCache()).toBe(false)
})

it('inactive editor remains editable, reactivation needs no decline confirmation and unchanged saves omit active', async () => {
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({...item,active:false}))
  const page=fixture('form',{editing:true,active:false})
  expect(page.render()).toContain('Item is hidden from all caches')
  page.change('item-title','Updated');page.submit();await page.settled()
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).not.toHaveProperty('active')
  const reactivating=fixture('form',{editing:true,active:false})
  reactivating.change('item-active',true);reactivating.submit();await reactivating.settled()
  expect(reactivating.dialogModel.open).toBe(false)
  expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toMatchObject({active:true})
})

it('deactivation plus cache changes keeps partial-save recovery private and never repeats the committed PATCH', async () => {
  let fail=true
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async (_path,init) => init?.method==='PATCH'
    ? Response.json({...item,active:false}) : fail ? Response.json({error:'not_found'},{status:404}) : new Response(null,{status:204}))
  const page=fixture('form',{editing:true,pendingCount:2,cacheId:cacheA.id})
  page.change('item-active',false);page.selectCache(cacheC.id,true);page.selectCache(cacheB.id,false)
  page.submit();page.render()
  expect(page.render()).toContain('Pending asks in these caches get declined')
  page.confirm();await page.settled();page.render()
  expect(page.render()).toContain('Successful changes are kept')
  expect(page.render()).toContain('id="item-active"')
  fail=false;page.confirm();await page.settled()
  expect(fetch.mock.calls.filter(call=>call[1]?.method==='PATCH')).toHaveLength(1)
  expect(page.sharedInCurrentCache()).toBe(false)
})

it('edit cache pills start from saved attachments, remain a local draft and leave on Cancel without writing', () => {
  const fetch = vi.spyOn(globalThis,'fetch'), page = fixture('form',{editing:true})
  expect(page.button('Tools').props['aria-pressed']).toBe(true)
  expect(page.button('Garden').props['aria-pressed']).toBe(true)
  expect(page.button('Club').props['aria-pressed']).toBe(false)
  page.selectCache(cacheA.id,false); page.selectCache(cacheC.id,true)
  expect(page.editorState().dirty).toBe(true)
  expect(page.dialogModel.open).toBe(false)
  click(page.button('Cancel'))
  expect(page.trace.at(-1)).toEqual(['cancel'])
  expect(fetch).not.toHaveBeenCalled()
  expect(fixture('form',{editing:true}).button('Tools').props['aria-pressed']).toBe(true)
})

it.each([false,true])('groups photo beside name/note before full-width sharing and Active (editing=%s)', editing => {
  const page=fixture('form',{editing,photoVersion:editing?'saved-version':undefined}), html=page.render()
  const top=html.slice(html.indexOf('class="cc-item-editor-top"'),html.indexOf('<fieldset class="cc-put-it-in"'))
  for(const field of ['cc-item-photo-field','cc-item-editor-copy','cc-item-title-field','cc-item-note-field'])expect(top).toContain(field)
  expect(top.indexOf('cc-item-photo-field')).toBeLessThan(top.indexOf('cc-item-editor-copy'))
  expect(top.indexOf('cc-item-title-field')).toBeLessThan(top.indexOf('cc-item-note-field'))
  expect(top).not.toContain('cc-item-active')
  expect(html.indexOf('cc-put-it-in')).toBeLessThan(html.indexOf('cc-item-active'))
  expect(html).toContain('aria-label="Close"')
})

it('bolds the singular waiting-decline sentence before any write',()=>{
  const fetch=vi.spyOn(globalThis,'fetch'),page=fixture('form',{editing:true,pendingCount:1})
  page.change('item-active',false);page.submit()
  expect(page.render()).toContain('<strong>1 waiting request will be declined.</strong>')
  expect(fetch).not.toHaveBeenCalled()
})

it('desktop Close uses the exact same Cancel handler without saving a dirty draft', () => {
  const fetch=vi.spyOn(globalThis,'fetch'), page=fixture('form',{editing:true})
  page.change('item-title','Changed')
  expect(page.button('Close').props.onClick).toBe(page.button('Cancel').props.onClick)
  click(page.button('Close'))
  expect(page.trace.at(-1)).toEqual(['cancel'])
  expect(page.editorState().dirty).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
})

it('edit waits for attachment metadata before Save and cannot silently clear unknown caches', () => {
  const fetch = vi.spyOn(globalThis,'fetch'), page = fixture('form',{editing:true,sharingLoading:true})
  expect(page.button('Save').props.disabled).toBe(true)
  expect(page.button('Tools').props.disabled).toBe(true)
  page.submit();expect(fetch).not.toHaveBeenCalled()
})

it('edit additions wait for Save, follow the item PATCH and disable controls while pending', async () => {
  let respond!: (response:Response) => void
  const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async (_path,init) => init?.method === 'PATCH' ? Response.json(item) : new Promise(resolve => {respond=resolve}))
  const page = fixture('form',{editing:true}); page.selectCache(cacheC.id,true)
  expect(fetch).not.toHaveBeenCalled()
  page.submit();await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));page.render()
  expect(page.button('Club').props.disabled).toBe(true)
  expect(page.button('Cancel').props.disabled).toBe(true)
  expect(page.button('Close').props.disabled).toBe(true)
  respond(new Response(null,{status:204}));await page.settled();page.render()
  expect(fetch.mock.calls.map(call => call[1]?.method)).toEqual(['PATCH','PUT'])
  expect(page.libraryItem().caches.map(cache => cache.id)).toEqual([cacheA.id,cacheB.id,cacheC.id])
  expect(page.toasts.notice).toMatchObject({message:'Item saved.',tone:'success'})
})

it('editor confirms all removals before any write, then saves fields, adds and removes with the route cache last', async () => {
  const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async (_path,init) => init?.method === 'PATCH' ? Response.json(item) : new Response(null,{status:204}))
  const page = fixture('form',{editing:true,cacheId:cacheA.id})
  page.selectCache(cacheA.id,false);page.selectCache(cacheB.id,false);page.selectCache(cacheC.id,true)
  page.submit();page.render()
  expect(page.dialogModel.open).toBe(true);expect(fetch).not.toHaveBeenCalled()
  expect(page.render()).toContain('<li>Tools</li><li>Garden</li>')
  expect(page.render()).toContain('Pending asks in these caches get declined')
  page.cancel();page.render();expect(fetch).not.toHaveBeenCalled()
  page.submit();page.render();expect(page.escape()).not.toHaveBeenCalled()
  page.submit();page.render();page.confirm();await page.settled();page.render()
  expect(fetch.mock.calls.map(call => [call[0],call[1]?.method])).toEqual([
    [`/api/caches/${cacheA.id}/items/${item.id}`,'PATCH'],
    [`/api/me/items/${item.id}/attachments/${cacheC.id}`,'PUT'],
    [`/api/me/items/${item.id}/attachments/${cacheB.id}`,'DELETE'],
    [`/api/me/items/${item.id}/attachments/${cacheA.id}`,'DELETE'],
  ])
  expect(page.libraryItem().caches.map(cache => cache.id)).toEqual([cacheC.id])
  expect(page.sharedInCurrentCache()).toBe(false)
})

it('editor keeps sharing successes and names failures; retry does not repeat fields or successful cache calls', async () => {
  let gardenAttempts=0
  const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async (path,init) => init?.method==='PATCH' ? Response.json(item)
    : String(path).endsWith(cacheB.id) && ++gardenAttempts===1 ? Response.json({error:'not_found'},{status:404}) : new Response(null,{status:204}))
  const context={editing:true,cacheId:cacheA.id,sharingLoading:false}
  const page=fixture('form',context)
  page.selectCache(cacheA.id,false);page.selectCache(cacheB.id,false);page.selectCache(cacheC.id,true)
  page.submit();page.render();page.confirm();await page.settled();page.render()
  expect(page.toasts.notice?.message).toContain("Couldn't save sharing for Garden.")
  expect(page.libraryItem().caches.map(cache => cache.id)).toEqual([cacheA.id,cacheB.id,cacheC.id])
  expect(page.trace.filter(row => row[0]==='saved')).toEqual([])
  expect(page.render()).toContain('Successful changes are kept')
  context.sharingLoading=true;page.render()
  expect(page.button('Retry sharing').props.disabled).toBe(false)
  expect(page.render()).toContain('<li>Garden</li><li>Tools</li>')
  page.confirm();await page.settled();page.render()
  expect(fetch.mock.calls.map(call => call[1]?.method)).toEqual(['PATCH','PUT','DELETE','DELETE','DELETE'])
  expect(fetch.mock.calls.filter(call => String(call[0]).endsWith(cacheC.id))).toHaveLength(1)
  expect(page.sharedInCurrentCache()).toBe(false)
})

it('existing-item row buttons toggle locally, keep already-shared rows disabled and retain partial additions', async () => {
  let tarpAttempts = 0
  const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async path => String(path).includes('/other/') && ++tarpAttempts === 1
    ? Response.json({error:'not_found'},{status:404}) : new Response(null,{status:204}))
  const page = fixture('add')
  expect(page.row('Tent').props).toMatchObject({'aria-pressed':true,disabled:true})
  click(page.row('Ladder')); page.render()
  expect(page.row('Ladder').props['aria-pressed']).toBe(true)
  click(page.row('Ladder')); page.render()
  expect(page.row('Ladder').props['aria-pressed']).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
  click(page.row('Ladder')); page.render(); click(page.row('Tarp')); page.render()
  click(page.button('Add 2 to Tools')); await page.settled(); page.render()
  expect(page.row('Ladder').props).toMatchObject({'aria-pressed':true,disabled:true})
  expect(page.row('Tarp').props).toMatchObject({'aria-pressed':true,disabled:false})
  click(page.button('Add 1 to Tools')); await page.settled()
  expect(fetch.mock.calls.map(call => call[0])).toEqual(['unshared','other','other'].map(id => `/api/me/items/${id}/attachments/${cacheA.id}`))
})

it('reports field, cache and photo drafts without saving, and clears dirty state when edits are undone', async () => {
  const fetch = vi.spyOn(globalThis,'fetch'), page = fixture('form')
  expect(page.editorState()).toEqual({dirty:false,committed:false})
  page.change('item-title','Tent'); expect(page.editorState().dirty).toBe(true)
  page.change('item-title',''); expect(page.editorState().dirty).toBe(false)
  page.selectCache(cacheA.id,true); expect(page.editorState().dirty).toBe(true)
  page.selectCache(cacheA.id,false); expect(page.editorState().dirty).toBe(false)
  page.change('new-item-photo',new File(['png'],'photo.png'))
  await page.prepared(); expect(page.editorState().dirty).toBe(true)
  click(page.button('Remove selected photo')); page.render()
  expect(page.editorState().dirty).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})

it('cache New item closes the chooser and opens the shared editor route without creating anything', () => {
  const fetch = vi.spyOn(globalThis,'fetch'), page = fixture('add')
  click(page.button('New item'))
  expect(page.trace).toEqual([['close','add-items-heading'],['navigate',`/caches/${cacheA.id}/items/new`,{state:{itemEditor:true}}]])
  expect(fetch).not.toHaveBeenCalled()
})

it('keeps sharing recovery inside the scroll body without duplicate mobile save actions', async () => {
  let created!: (response: Response) => void, attached!: (response: Response) => void
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(path => new Promise(resolve => {
    if (path === '/api/me/items') created = resolve
    else attached = resolve
  }))
  const page = fixture('form')
  expect(page.editorState()).toEqual({dirty:false,committed:false})
  page.change('item-title', 'Tent'); page.selectCache(cacheA.id, true)
  expect(page.editorState()).toEqual({dirty:true,committed:false})
  expect(page.recoveryActions()).toBeUndefined()
  expect(page.render()).toContain('cc-item-editor-header')
  expect(page.render()).toContain('cc-item-editor-desktop-actions')
  page.submit(); page.render()
  created(Response.json(item))
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  page.render()
  expect(page.editorState()).toEqual({dirty:true,committed:true})
  expect(page.recoveryActions()).toBeUndefined()
  attached(Response.json({ error: 'internal_error' }, { status: 503 }))
  await page.settled(); page.render()
  expect(page.recoveryActions()).toBeDefined()
  expect(descendants(page.recoveryActions()!.props.children as ReactNode).filter(node => node.type === 'button').map(text)).toEqual(['Keep item without remaining shares'])
  expect(page.render()).toContain('Retry sharing')
  page.submit(); page.render()
  expect(page.recoveryActions()).toBeUndefined()
  attached(new Response(null, { status: 204 }))
  await page.settled(); page.render()
  expect(page.recoveryActions()).toBeUndefined()
  expect(fetch.mock.calls.filter(call => call[0] === '/api/me/items')).toHaveLength(1)
  expect(page.trace.filter(row => row[0] === 'saved')).toEqual([['saved', item.id]])
})

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
  await page.prepared()
  expect(page.preview().props.src).toMatch(/^blob:/)
  expect(page.render()).not.toContain('photo.png')
  page.submit(); await page.settled()
  expect(page.render()).toContain('Retry photo')
  expect(page.recoveryActions()).toBeDefined()
  expect(page.render()).toContain('<fieldset disabled="" class="cc-item-fields"')
  page.submit(); await page.settled(); expect(page.render()).toContain('Retry sharing')
  expect(page.render()).toContain('Garden. Already shared caches are kept.')
  page.submit(); await page.settled()
  expect(fetch.mock.calls.map(call => call[0])).toEqual([
    '/api/me/items', `/api/me/items/${item.id}/photo`, `/api/me/items/${item.id}/photo`,
    `/api/me/items/${item.id}/attachments/${cacheA.id}`, `/api/me/items/${item.id}/attachments/${cacheB.id}`, `/api/me/items/${item.id}/attachments/${cacheB.id}`,
  ])
  expect(page.resizePhoto).toHaveBeenCalledOnce()
  const uploads = fetch.mock.calls.filter(call => String(call[0]).endsWith('/photo'))
  expect(uploads[0][1]?.body).toBe(uploads[1][1]?.body)
  expect(page.trace.filter(row => row[0] === 'saved')).toEqual([['saved', item.id]])
  expect(page.trace.slice(-13)).toEqual([['saved', item.id], ['busy', false], ...invalidations.map(key => ['invalidate', [key]])])
})

it('keeps decode failure before create, explicit Continue without photo and Keep without remaining shares', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async path => path === '/api/me/items' ? Response.json(item) : Response.json({ error: 'not_found' }, { status: 404 }))
  const page = fixture('form')
  page.resizePhoto.mockRejectedValueOnce(new Error(PHOTO_READ_ERROR))
  page.change('item-title', 'Tent'); page.change('new-item-photo', new File(['png'], 'photo.png', { type: 'image/png' }))
  page.selectCache(cacheA.id, true)
  await page.prepared()
  page.submit(); await page.settled(); expect(fetch).not.toHaveBeenCalled()
  expect(page.render()).toContain("Couldn&#x27;t read that image, try another.")
  page.change('new-item-photo', new File(['png'], 'replacement.png', { type: 'image/png' }))
  await page.prepared()
  page.submit(); await page.settled(); expect(page.render()).toContain('Retry photo')
  click(page.button('Continue without photo')); await page.settled()
  expect(page.render()).toContain('Keep item without remaining shares')
  click(page.button('Keep item without remaining shares'))
  expect(fetch.mock.calls.filter(call => call[0] === '/api/me/items')).toHaveLength(1)
  expect(fetch.mock.calls.filter(call => String(call[0]).endsWith('/photo'))).toHaveLength(1)
  expect(page.trace.filter(row => row[0] === 'saved')).toEqual([['saved', item.id]])
})

it('keeps editor sharing recovery guidance inline after an operational error toast is dismissed', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_path,init) => init?.method==='PATCH' ? Response.json(item) : Response.json({ error: 'internal_error' }, { status: 503 }))
  const page = fixture('form', { editing:true, cacheId: cacheA.id })
  page.open(); page.confirm(); await page.settled()
  expect(page.toasts.notice).toMatchObject({ message: "Couldn't save sharing for Tools. Could not complete that request. Please try again.", tone: 'error' })
  page.toasts.modules['../components/Toast'].useToast().dismissToast()
  const html = page.render()
  expect(page.toasts.notice).toBeNull()
  expect(html).not.toContain('cc-toast-message')
  expect(html).toContain('Successful changes are kept')
  expect(html).toContain('You can retry here.')
  expect(html).toContain('save sharing for Tools.')
  expect(page.dialogModel.open).toBe(true)
})

it('toasts an operational partial-save failure while keeping recovery state inline', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => path === '/api/me/items' ? Response.json(item) : Response.json({ error: 'internal_error' }, { status: 503 }))
  const page = fixture('form')
  page.change('item-title', 'Tent'); page.selectCache(cacheA.id, true)
  page.submit(); await page.settled()
  const html = page.render()
  expect(page.toasts.notice).toMatchObject({ message: "Couldn't save sharing for Tools. Could not complete that request. Please try again.", tone: 'error' })
  expect(html).toContain('cc-toast-error')
  expect(html).toContain('Your item is saved')
  expect(html).toContain('Sharing needs retrying.')
  expect(html).toContain('Keep item without remaining shares')
  expect(html).not.toContain('<p role="alert" class="cc-form-error">Could not complete')
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

it('saved photos use the private preview and x stages removal with dirty state, no request until PATCH then DELETE', async () => {
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async (_path,init)=>init?.method==='PATCH'?Response.json({...item,photo_version:'saved-version'}):new Response(null,{status:204}))
  const page=fixture('form',{editing:true,photoVersion:'saved-version'})
  expect(page.preview().props.src).toBe(`/api/me/items/${item.id}/photo?v=saved-version`)
  expect(page.render()).toContain('Tap the photo to replace')
  expect(page.render()).toContain('Click to replace')
  expect(page.render()).not.toMatch(/Upload photo|Resized to|Camera or library/)
  expect(page.editorState().dirty).toBe(false)
  click(page.button('Remove saved photo'));page.render()
  expect(page.preview().props.src).toBeNull()
  expect(page.editorState().dirty).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
  page.setPhotoVersion('newer-version')
  page.submit();await page.settled()
  expect(fetch.mock.calls.map(call=>call[1]?.method)).toEqual(['PATCH','DELETE'])
  expect(fetch.mock.calls[1][1]?.body).toBe('{"photo_version":"saved-version"}')
})

it('x discards a replacement selection and restores the saved photo without scheduling its removal', async () => {
  const fetch=vi.spyOn(globalThis,'fetch'),page=fixture('form',{editing:true,photoVersion:'saved-version'})
  page.change('new-item-photo',new File(['png'],'photo.png'))
  await page.prepared()
  expect(page.preview().props.src).toMatch(/^blob:/)
  click(page.button('Remove selected photo'));page.render()
  expect(page.preview().props.src).toBe(`/api/me/items/${item.id}/photo?v=saved-version`)
  expect(page.editorState().dirty).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})

it('photo removal failure keeps the editor recovery state and allows retry or explicit Keep current photo', async () => {
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async (_path,init)=>init?.method==='PATCH'?Response.json({...item,photo_version:'saved-version'}):Response.json({error:'photo_changed'},{status:409}))
  const page=fixture('form',{editing:true,photoVersion:'saved-version'})
  click(page.button('Remove saved photo'));page.render();page.submit();await page.settled();page.render()
  expect(page.render()).toContain('Retry photo')
  expect(page.render()).toContain('The photo has changed')
  click(page.button('Keep current photo'));await page.settled()
  expect(fetch.mock.calls.map(call=>call[1]?.method)).toEqual(['PATCH','DELETE'])
  expect(page.trace.filter(row=>row[0]==='saved')).toEqual([['saved',item.id]])
})
