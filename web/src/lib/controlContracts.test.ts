import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ReactElement, type ReactNode } from 'react'
import * as React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { ApiError, apiFetch, errorMessage } from './api'
import * as contacts from './contacts'
import * as cats from './cats'
import * as push from './push'
import * as peek from './peek'
import * as install from './install'
import { configQuery } from './config'
import { PHOTO_READ_ERROR, uploadProfilePhoto } from './photos'
import { refreshProfileViews } from './profile'
import { toastFixture } from '../test/toastFixture'

type Element = ReactElement<Record<string, unknown>>
type Page = 'ProfilePhotoControls' | 'ContactControls' | 'PushControls' | 'CoatControls' | 'PeekControls'
type MutationOptions = {
  mutationFn: (variables?: unknown) => Promise<unknown>
  onMutate?: (variables?: unknown) => unknown
  onSuccess?: (data: unknown, variables?: unknown) => unknown
  onError?: (error: unknown, variables?: unknown) => unknown
  onSettled?: () => unknown
}
const me = { id: 'owner', display_name: 'Neighbor', email: 'private-auth@example.test', cat_coat: 'grey', profile_photo_version: 'old-photo' }
const contact: contacts.Contact = { kind: 'email', value: 'chosen@example.test', link: 'mailto:chosen@example.test' }
const requestKeys = ['item-requests', 'requests', 'item', 'items', 'library', 'library-item', 'home-summary', 'caches', 'cache', 'request-detail', 'request-contact']
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function content(node: Element): string {
  return React.Children.toArray(node.props.children as ReactNode).map(child => React.isValidElement(child) ? content(child as Element) : String(child)).join('')
}
function fixture(page: Page, options: { subscribed?: boolean; noPhoto?: boolean } = {}) {
  const toasts = toastFixture()
  const trace: unknown[][] = [], states: unknown[] = [], refs: { current: unknown }[] = []
  const effects: { dependencies: unknown[]; cleanup?: () => void }[] = []
  const storage = new Map<string, string>(options.subscribed ? [[push.PUSH_OWNER_KEY, me.id]] : [])
  let elements: Element[] = [], stateIndex = 0, refIndex = 0, effectIndex = 0
  let lastMutation = Promise.resolve(), mutationOptions: MutationOptions
  let previewKey = '', previewOptions: Record<string, unknown>
  let subscribed = options.subscribed ?? false
  const mutation = { pending: false, success: false, error: null as unknown }
  const ownContact = { data: { contact }, isPending: false, isError: false, isSuccess: true, refetch: vi.fn() }
  const preview = { data: undefined as { contact: contacts.Contact } | undefined, isError: false, isFetching: false, error: null as unknown }
  const config = { data: { vapid_public_key: 'BA'.repeat(43) + 'A' }, isPending: false, isError: false, isSuccess: true, isFetching: false, refetch: vi.fn() }
  const client = { invalidateQueries: vi.fn(({ queryKey }: { queryKey: string[] }) => { trace.push(['invalidate', queryKey]); return Promise.resolve() }) }
  const fileInput = { value: '' }
  const resized = new Blob(['resized image'], { type: 'image/jpeg' })
  const resizePhoto = vi.fn(async (_file: File) => resized)
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/browser',
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/browser', keys: { p256dh: 'browser-key', auth: 'auth-key' } }),
    unsubscribe: vi.fn(async () => { subscribed = false; trace.push(['unsubscribe']); return true }),
  }
  const notification = { close: vi.fn(() => trace.push(['close-notification'])) }
  const registration = {
    pushManager: { getSubscription: vi.fn(async () => subscribed ? subscription : null), subscribe: vi.fn(async () => { subscribed = true; trace.push(['subscribe']); return subscription }) },
    getNotifications: vi.fn(async () => [notification]),
  }
  const permission = vi.fn(async () => { trace.push(['permission']); return 'granted' })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); trace.push(['store', key, value]) },
    removeItem: (key: string) => { storage.delete(key); trace.push(['remove-storage', key]) },
  })
  vi.stubGlobal('Notification', { requestPermission: permission })
  vi.stubGlobal('window', { PushManager: {}, Notification: {}, matchMedia: () => ({ matches: true }) })
  vi.stubGlobal('navigator', { userAgent: 'Desktop', platform: 'Linux', maxTouchPoints: 0, serviceWorker: {
    register: vi.fn(async (...args: unknown[]) => { trace.push(['register', ...args]); return registration }),
    ready: Promise.resolve(registration), getRegistration: vi.fn(async () => registration),
  } })
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }))
  const dialogModel = {
    open: false,
    showModal() { this.open = true; trace.push(['open']); const target = elements.find(node => node.props.autoFocus); trace.push(['focus', target ? content(target) : '']) },
    close() { this.open = false; trace.push(['close']); const dialog = elements.find(node => node.type === 'dialog'); (dialog?.props.onClose as (() => void) | undefined)?.() },
  }
  const record = (factory: typeof jsx) => (...args: Parameters<typeof jsx>) => { const node = factory(...args); elements.push(node as Element); return node }
  const Null = () => null
  const modules: Record<string, unknown> = {
    ...toasts.modules,
    react: {
      ...React,
      useState(initial: unknown) { const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], (value: unknown) => { states[index] = typeof value === 'function' ? value(states[index]) : value }] },
      useRef(initial: unknown) { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }) },
      useEffect(effect: () => (() => void) | void, dependencies: unknown[]) {
        const index = effectIndex++, previous = effects[index]
        if (previous && previous.dependencies.length === dependencies.length && dependencies.every((value, slot) => Object.is(value, previous.dependencies[slot]))) return
        previous?.cleanup?.()
        effects[index] = { dependencies, cleanup: effect() ?? undefined }
      },
    },
    'react/jsx-runtime': { jsx: record(jsx), jsxs: record(jsxs), Fragment: React.Fragment },
    '@tanstack/react-query': {
      useQueryClient: () => client,
      useQuery(configuration: Record<string, unknown>) {
        if ((configuration.queryKey as string[])[0] === 'config') return config
        const key = JSON.stringify(configuration.queryKey)
        if (key !== previewKey) { previewKey = key; preview.data = undefined; preview.isError = false }
        previewOptions = configuration; return preview
      },
      useMutation(configuration: MutationOptions) {
        mutationOptions = configuration
        return {
          get isPending() { return mutation.pending }, get isError() { return !!mutation.error }, get isSuccess() { return mutation.success }, get error() { return mutation.error },
          reset() { mutation.pending = false; mutation.error = null; mutation.success = false },
          mutate(variables?: unknown) {
            mutation.pending = true; mutation.error = null; mutation.success = false
            lastMutation = (async () => {
              try { await mutationOptions.onMutate?.(variables); const data = await mutationOptions.mutationFn(variables); await mutationOptions.onSuccess?.(data, variables); mutation.success = true }
              catch (error) { mutation.error = error; await mutationOptions.onError?.(error, variables) }
              finally { await mutationOptions.onSettled?.(); mutation.pending = false }
            })()
          },
        }
      },
    },
    '../auth/AuthProvider': { useAuth: () => ({ me: { ...me, profile_photo_version: options.noPhoto ? null : me.profile_photo_version } }) },
    '../lib/api': { ApiError, apiFetch, errorMessage }, '../lib/photos': { PHOTO_READ_ERROR, resizePhoto, uploadProfilePhoto },
    '../lib/profile': { refreshProfileViews }, '../lib/cats': cats, '../lib/push': push, '../lib/peek': peek,
    '../lib/config': { configQuery }, '../lib/contacts': { ...contacts, useOwnContact: () => ownContact },
    '../components/Avatar': { Avatar: Null }, '../components/CoatPicker': { CoatPicker: Null },
    '../components/InstallHint': { IOSInstallInstructions: Null }, '../lib/install': install,
    '../components/PhotoPreview': { PhotoPreview: Null },
    '../components/ContactLink': { ContactLink: ({ contact }: { contact: contacts.Contact }) => createElement('a', { href: contact.link }, contact.value), PlatformIcon: Null },
    '../components/Skeleton': { Shimmer: Null, LoadingStatus: Null, LoadingLines: Null }, '../components/CoatControls': { CoatControls: Null },
  }
  const hook = { exports: {} }
  const hookSource = readFileSync(new URL('./usePhotoSelection.ts', import.meta.url), 'utf8')
  const hookCompiled = ts.transpileModule(hookSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', hookCompiled)((name: string) => name === 'react' ? modules.react : { resizePhoto }, hook, hook.exports)
  modules['../lib/usePhotoSelection'] = hook.exports
  const source = readFileSync(new URL(`../${page === 'CoatControls' || page === 'PeekControls' ? 'components' : 'pages'}/${page}.tsx`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as Record<string, React.ComponentType<Record<string, unknown>>> }
  new Function('require', 'module', 'exports', compiled)((name: string) => { if (!(name in modules)) throw new Error(`Unexpected control dependency ${name}`); return modules[name] }, module, module.exports)
  const props = page === 'PushControls' ? { userId: me.id } : page === 'CoatControls' ? { resettable: true, onBusy: (busy: boolean) => trace.push(['busy', busy]) } : {}
  function render() {
    elements = []; stateIndex = 0; refIndex = 0; effectIndex = 0
    const html = renderToStaticMarkup(createElement(React.Fragment, null, createElement(module.exports[page], props), toasts.element()))
    for (const node of elements) {
      if (node.type === 'dialog') (node.props.ref as { current: unknown }).current = dialogModel
      if (node.type === 'input' && node.props.type === 'file') (node.props.ref as { current: unknown }).current = fileInput
    }
    return html
  }
  function button(label: string) {
    const node = [...elements].reverse().find(node => node.type === 'button' && (content(node) === label || node.props['aria-label'] === label))
    if (!node) throw new Error(`Missing ${page} button ${label}`)
    return node
  }
  function click(label: string) { (button(label).props.onClick as () => void)(); render() }
  function change(id: string, value: unknown) {
    const node = elements.find(node => node.props.id === id)!
    ;(node.props.onChange as (event: unknown) => void)({ target: id.includes('photo') ? { files: value ? [value] : [] } : { value } }); render()
  }
  function submit() { (elements.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() }) }
  function escape() {
    const preventDefault = vi.fn(); (elements.find(node => node.type === 'dialog')!.props.onCancel as (event: unknown) => void)({ preventDefault })
    if (!preventDefault.mock.calls.length) dialogModel.close()
    return preventDefault
  }
  render()
  return {
    toasts, trace, render, button, click, change, submit, escape, client, preview, ownContact, config, resizePhoto, fileInput, dialogModel, storage, permission, subscription, registration, notification,
    field: (id: string) => elements.find(node => node.props.id === id)!, settled: () => lastMutation,
    picker: () => elements.find(node => node.props.names === true)!,
    photoPreview: () => elements.find(node => node.props.alt === 'Selected profile photo preview')!,
    coatBusy(busy: boolean) { (elements.find(node => node.props.className === 'cc-photo-coat-mobile')!.props.onBusy as (value: boolean) => void)(busy); render() },
    toggle() { (elements.find(node => node.props.role === 'switch')!.props.onChange as () => void)(); render() },
    radio(value: string) { (elements.find(node => node.type === 'input' && node.props.value === value)!.props.onChange as () => void)(); render() },
    previewOptions: () => previewOptions,
    async readPreview() { try { preview.data = await (previewOptions.queryFn as () => Promise<{ contact: contacts.Contact }>)(); preview.isError = false } catch (error) { preview.data = undefined; preview.isError = true; preview.error = error } render() },
    async flush() { for (let index = 0; index < 30; index++) await Promise.resolve(); return render() },
    unmount() { effects.forEach(effect => effect.cleanup?.()) },
  }
}

it('photo sheet keeps Close autofocus, idle dismissal cleanup and coat-busy/pending Escape guards', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch'), page = fixture('ProfilePhotoControls')
  page.click('Change photo'); expect(page.trace.at(-1)).toEqual(['focus', 'Close'])
  page.change('profile-photo-file', new File(['png'], 'photo.png')); page.fileInput.value = 'photo.png'
  page.coatBusy(true); expect(page.button('Close').props.disabled).toBe(true); expect(page.escape()).toHaveBeenCalledOnce()
  page.coatBusy(false); page.click('Close'); expect(page.fileInput.value).toBe(''); expect(page.button('Save photo').props.disabled).toBe(true)
  page.click('Change photo'); expect(page.escape()).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
})

it('photo decode/upload errors retain the selection, retry replaces via the exact self route and refreshes before clear/close', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ error: 'invalid_photo' }, { status: 400 })).mockImplementation(async () => Response.json(me))
  const page = fixture('ProfilePhotoControls'); page.click('Change photo')
  page.resizePhoto.mockRejectedValueOnce(new Error(PHOTO_READ_ERROR))
  page.change('profile-photo-file', new File(['png'], 'photo.png')); page.fileInput.value = 'photo.png'
  await page.flush(); page.submit(); await page.settled()
  expect(fetch).not.toHaveBeenCalled(); expect(page.render()).toContain('Couldn&#x27;t read that image, try another.')
  page.change('profile-photo-file', new File(['png'], 'photo.png')); await page.flush()
  expect(page.photoPreview().props.src).toMatch(/^blob:/)
  expect(page.render()).not.toContain('photo.png')
  page.submit(); page.render(); expect(page.escape()).toHaveBeenCalledOnce(); await page.settled()
  expect(page.fileInput.value).toBe('photo.png'); expect(page.dialogModel.open).toBe(true)
  page.trace.length = 0; page.submit(); await page.settled()
  expect(fetch.mock.calls.every(call => call[0] === '/api/me/photo' && call[1]?.method === 'POST' && call[1]?.credentials === 'same-origin' && call[1]?.body instanceof Blob)).toBe(true)
  expect(page.trace).toEqual([...['me', 'cache', 'join-requests', ...requestKeys].map(key => ['invalidate', [key]]), ['close']])
  expect(page.fileInput.value).toBe(''); expect(page.dialogModel.open).toBe(false)
  page.render(); expect(page.photoPreview().props.src).toBeNull()
  expect(page.resizePhoto).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[0][1]?.body).toBe(fetch.mock.calls[1][1]?.body)
  expect(page.toasts.notice).toMatchObject({ message: 'Photo saved.', tone: 'success' })
})

it('photo admission errors keep the sheet and selection with clear retry-later copy', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'rate_limited', limit: 'photo_upload' }, { status: 429 }))
  const page = fixture('ProfilePhotoControls')
  page.click('Change photo'); page.change('profile-photo-file', new File(['png'], 'photo.png')); page.fileInput.value = 'photo.png'
  await page.flush(); page.submit(); await page.settled()
  expect(page.render()).toContain('Too many photo uploads, try again later.')
  expect(page.dialogModel.open).toBe(true)
  expect(page.fileInput.value).toBe('photo.png')
})

it('photo removal sends a bodyless self DELETE, while missing photos keep removal disabled', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
  const absent = fixture('ProfilePhotoControls', { noPhoto: true }); expect(absent.button('Remove photo').props.disabled).toBe(true)
  const page = fixture('ProfilePhotoControls'); page.click('Change photo'); page.click('Remove photo'); await page.settled()
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/me/photo', expect.objectContaining({ method: 'DELETE', credentials: 'same-origin', body: undefined }))
  expect(page.dialogModel.open).toBe(false)
})

it('contact open uses only chosen contact, preserves 250ms debounce and invalid preview errors without auth-email prefill', async () => {
  vi.useFakeTimers()
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'invalid_contact' }, { status: 400 }))
  const page = fixture('ContactControls'); page.click('Edit contact')
  expect(page.field('contact-value').props.value).toBe(contact.value); expect(page.render()).not.toContain(me.email)
  expect(page.previewOptions()).toMatchObject({ queryKey: ['contact-preview', me.id, 'email', ''], enabled: false, retry: false, gcTime: 0 })
  page.change('contact-value', 'not an email'); await vi.advanceTimersByTimeAsync(249); page.render(); expect(page.previewOptions().enabled).toBe(false)
  await vi.advanceTimersByTimeAsync(1); page.render(); expect(page.previewOptions()).toMatchObject({ queryKey: ['contact-preview', me.id, 'email', 'not an email'], enabled: true })
  await page.readPreview(); expect(page.render()).toContain('Enter a valid phone number, platform username or chosen email address, not a URL.')
  expect(page.button('Save contact').props.disabled).toBe(true); expect(fetch.mock.calls[0][1]?.body).toBe('{"kind":"email","value":"not an email"}')
})

it('contact platform changes clear value/preview, save retains errors then invalidates both contact keys before close', async () => {
  vi.useFakeTimers()
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/preview') ? Response.json({ contact }) : Response.json({ error: 'internal_error' }, { status: 503 }))
  const page = fixture('ContactControls'); page.click('Edit contact'); page.click('WhatsApp'); expect(page.field('contact-value').props.value).toBe('')
  page.click('Email'); page.change('contact-value', contact.value); await vi.advanceTimersByTimeAsync(250); page.render(); await page.readPreview()
  expect(page.render()).toContain(contact.link); expect(page.button('Save contact').props.disabled).toBe(false)
  page.submit(); page.render(); expect(page.escape()).toHaveBeenCalledOnce(); await page.settled(); expect(page.dialogModel.open).toBe(true)
  expect(page.render()).toContain('Could not complete that request. Please try again.')
  fetch.mockImplementation(async () => Response.json({ contact })); page.trace.length = 0; page.submit(); await page.settled()
  expect(fetch.mock.calls.at(-1)).toEqual(['/api/me/contact', expect.objectContaining({ method: 'PUT', credentials: 'same-origin', body: '{"kind":"email","value":"chosen@example.test"}' })])
  expect(page.trace).toEqual([['invalidate', ['own-contact']], ['invalidate', ['request-contact']], ['close']])
  page.render(); expect(page.field('contact-value').props.value).toBe('')
})

it('contact removal and idle Close/Escape retain bodyless DELETE, safe focus and no-write dismissal', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 })), page = fixture('ContactControls')
  page.click('Edit contact'); expect(page.trace.at(-1)).toEqual(['focus', 'Close']); page.click('Close'); expect(fetch).not.toHaveBeenCalled()
  page.click('Edit contact'); expect(page.escape()).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  page.click('Edit contact'); page.click('Remove contact'); await page.settled()
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/me/contact', expect.objectContaining({ method: 'DELETE', credentials: 'same-origin', body: undefined }))
})

it('push asks permission only on explicit enable, uses browser subscription and cleans up on explicit disable', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 204 })), page = fixture('PushControls')
  await page.flush(); expect(page.permission).not.toHaveBeenCalled(); expect(page.registration.pushManager.subscribe).not.toHaveBeenCalled()
  page.toggle(); expect(page.permission).toHaveBeenCalledOnce(); await page.flush()
  expect(page.render()).toContain('Notifications enabled for this account on this browser.')
  expect(page.toasts.notice).toMatchObject({ message: 'Notifications enabled for this account on this browser.', tone: 'success' })
  expect(page.storage.get(push.PUSH_OWNER_KEY)).toBe(me.id)
  page.toggle(); await page.flush(); expect(page.render()).toContain('Notifications disabled on this browser.')
  expect(fetch.mock.calls.map(call => [call[1]?.method, call[0]])).toEqual([['POST', '/api/push/subscribe'], ['DELETE', '/api/push/subscribe']])
  expect(page.subscription.unsubscribe).toHaveBeenCalledOnce(); expect(page.notification.close).toHaveBeenCalledOnce()
  page.unmount()
})

it('push failed registration does not show enabled state, and unmount prevents late registration state', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'push_limit' }, { status: 409 })), page = fixture('PushControls')
  await page.flush(); page.toggle(); await page.flush()
  expect(page.render()).toContain('Notifications are already enabled on three browsers for this account.')
  expect(page.storage.has(push.PUSH_OWNER_KEY)).toBe(false); expect(page.subscription.unsubscribe).toHaveBeenCalledOnce()
  expect(fetch).toHaveBeenCalledOnce(); page.unmount()
  const removed = fixture('PushControls'); removed.unmount(); await removed.flush()
  expect(removed.registration.pushManager.getSubscription).not.toHaveBeenCalled()
})

it('coat save/reset preserves busy→PATCH→profile refresh→idle order and pending controls', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(me)), page = fixture('CoatControls')
  ;(page.picker().props.onChange as (coat: string) => void)('ginger'); page.render()
  expect(page.picker().props.disabled).toBe(true); await page.settled()
  expect(page.trace).toEqual([['busy', true], ...['me', 'cache', 'join-requests', ...requestKeys].map(key => ['invalidate', [key]]), ['busy', false]])
  expect(fetch.mock.calls[0][1]?.body).toBe('{"cat_coat":"ginger"}')
  page.render(); page.click('Use my default cat'); await page.settled(); expect(fetch.mock.calls[1][1]?.body).toBe('{"cat_coat":null}')
})

it('coat failure reports error and releases busy without refreshing private views', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'invalid_cat_coat' }, { status: 400 }))
  const page = fixture('CoatControls'); (page.picker().props.onChange as (coat: string) => void)('ginger'); await page.settled()
  expect(page.render()).toContain('Choose one of the six cat coats, or use your default cat.')
  expect(page.trace).toEqual([['busy', true], ['busy', false]])
})

it('peek radios persist only the device preference, update help text and retain reduced-motion guidance', () => {
  const fetch = vi.spyOn(globalThis, 'fetch'), page = fixture('PeekControls')
  expect(page.render()).toContain('Reduced motion is on for this device')
  page.radio('first'); expect(peek.getPeekMode()).toBe('first'); expect(page.render()).toContain('Plays the first time you open each cache on this device.')
  page.radio('never'); expect(peek.getPeekMode()).toBe('never')
  page.radio('always'); expect(peek.getPeekMode()).toBe('always'); expect(page.storage.has('cc_peek_mode')).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})
