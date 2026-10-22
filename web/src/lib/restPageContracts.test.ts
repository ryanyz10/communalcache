import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ReactElement, type ReactNode } from 'react'
import * as React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import * as Router from 'react-router'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { ApiError, apiFetch, errorMessage } from './api'
import * as caches from './caches'
import * as joining from './joining'
import * as pendingJoin from './pendingJoin'
import * as magicLinks from './magicLinks'
import * as googleSignIn from './googleSignIn'
import { refreshProfileViews } from './profile'
import { toastFixture } from '../test/toastFixture'
import { FieldCheck } from '../components/FieldCheck'

type Element = ReactElement<Record<string, unknown>>
type Page = 'HomePage' | 'AccountPage' | 'JoinInviteSheet' | 'JoinRequests' | 'LoginPage' | 'MagicLinkPage' | 'JoinPage' | 'OnboardingPage'
type MutationOptions = {
  mutationFn: (variables?: unknown) => Promise<unknown>
  onSuccess?: (data: unknown, variables?: unknown) => unknown
  onError?: (error: unknown, variables?: unknown) => unknown
  onSettled?: () => unknown
}
const cacheId = '11111111-1111-4111-8111-111111111111'
const token = `${cacheId}.${'A'.repeat(43)}`
const me = { id: 'owner', display_name: 'Owner', email: 'private-auth@example.test', cat_coat: 'grey' }
const requestKeys = ['item-requests', 'requests', 'item', 'items', 'library', 'library-item', 'home-summary', 'caches', 'cache', 'request-detail', 'request-contact']
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function nodeText(node: Element): string {
  return React.Children.toArray(node.props.children as ReactNode).map(child => React.isValidElement(child) ? nodeText(child as Element) : String(child)).join('')
}

function fixture(page: Page, options: { inviteToken?: string; invalidLink?: boolean; googleError?: boolean } = {}) {
  const toasts = toastFixture()
  const trace: unknown[][] = [], states: unknown[] = [], refs: { current: unknown }[] = [], effects: (() => void)[] = []
  const queries: Record<string, unknown>[] = [], storage = new Map<string, string>()
  let elements: Element[] = [], stateIndex = 0, refIndex = 0, mounted = false
  let lastMutation = Promise.resolve(), lastAction: unknown
  let mutationOptions: MutationOptions
  const mutation = { pending: false, success: false, error: null as unknown, data: undefined as unknown, variables: undefined as unknown }
  const query = { data: { name: 'Tools', active_member_count: 1, members: [] }, isPending: false, isError: false, isSuccess: true, isFetching: false, refetch: vi.fn(async () => {}) }
  const auth = {
    me, refresh: vi.fn(async () => { trace.push(['refresh']) }),
    signOut: vi.fn(async () => { trace.push(['sign-out']) }),
  }
  const client = {
    invalidateQueries: vi.fn(({ queryKey }: { queryKey: unknown[] }) => { trace.push(['invalidate', queryKey]); return Promise.resolve() }),
    removeQueries: vi.fn(({ predicate }: { predicate: (query: { queryKey: string[] }) => boolean }) => { trace.push(['remove-private', predicate({ queryKey: ['me'] }), predicate({ queryKey: ['items'] })]) }),
    getQueryData: () => me,
  }
  const bot = { reset: vi.fn(() => trace.push(['bot-reset'])), retry: vi.fn(() => trace.push(['bot-retry'])) }
  const email = { reportValidity: vi.fn(() => true), focus: vi.fn(() => trace.push(['focus', 'email'])) }
  const edit = { focus: vi.fn(() => trace.push(['focus', 'edit-name'])) }
  function dialogNode(name: string) {
    return elements.find(node => node.type === 'dialog' && node.props['aria-labelledby'] === name)
  }
  const dialogs = new Map<string, { open: boolean; showModal: () => void; close: () => void }>()
  function dialog(name: string) {
    if (!dialogs.has(name)) dialogs.set(name, {
      open: false,
      showModal() { this.open = true; trace.push(['open', name]) },
      close() {
        this.open = false; trace.push(['close', name])
        ;(dialogNode(name)?.props.onClose as (() => void) | undefined)?.()
      },
    })
    return dialogs.get(name)!
  }
  const useMutation = (configuration: MutationOptions) => {
    mutationOptions = configuration
    return {
      get isPending() { return mutation.pending }, get isSuccess() { return mutation.success }, get isError() { return !!mutation.error },
      get error() { return mutation.error }, get data() { return mutation.data }, get variables() { return mutation.variables },
      reset() { mutation.pending = false; mutation.success = false; mutation.error = null },
      mutate(variables?: unknown) {
        mutation.pending = true; mutation.success = false; mutation.error = null; mutation.variables = variables
        lastMutation = (async () => {
          try { mutation.data = await mutationOptions.mutationFn(variables); await mutationOptions.onSuccess?.(mutation.data, variables); mutation.success = true }
          catch (error) { mutation.error = error; await mutationOptions.onError?.(error, variables) }
          finally { await mutationOptions.onSettled?.(); mutation.pending = false }
        })()
      },
    }
  }
  const record = (factory: typeof jsx) => (...args: Parameters<typeof jsx>) => { const node = factory(...args); elements.push(node as Element); return node }
  const Null = () => null
  const GoogleButton = () => null
  const Container = ({ children }: { children: ReactNode }) => createElement('div', null, children)
  const modules: Record<string, unknown> = {
    ...toasts.modules,
    react: {
      ...React,
      useState(initial: unknown) {
        const index = stateIndex++
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
        return [states[index], (value: unknown) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
      },
      useRef(initial: unknown) { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }) },
      useCallback(callback: unknown) { return callback },
      useEffect(effect: () => void) { if (!mounted) effects.push(effect) },
    },
    'react/jsx-runtime': { jsx: record(jsx), jsxs: record(jsxs), Fragment: React.Fragment },
    'react-router': { ...Router, useParams: () => ({ token: options.inviteToken ?? token }), useNavigate: () => (...args: unknown[]) => trace.push(['navigate', ...args]), useSearchParams: () => [new URLSearchParams(options.googleError ? 'error=access_denied&error_description=private-provider-detail' : '')] },
    '@tanstack/react-query': {
      useQueryClient: () => client, useMutation,
      useQuery(configuration: Record<string, unknown>) {
        queries.push(configuration)
        const key = configuration.queryKey as string[]
        if (key[0] === 'caches') return { ...query, data: [] }
        if (key[0] === 'join-requests') return { ...query, data: [{ user_id: 'member', display_name: 'Neighbor', created_at: 1 }] }
        return query
      },
    },
    '../auth/AuthProvider': { useAuth: () => auth, useProfile: () => auth.me }, '../lib/api': { ApiError, apiFetch, errorMessage },
    '../lib/caches': { ...caches, useHomeSummary: () => ({ data: undefined, isError: false }) },
    '../lib/items': { useLibrary: () => ({ data: { pages: [{ items: [] }] }, isSuccess: true }) },
    '../lib/pendingJoin': pendingJoin, '../lib/magicLinks': magicLinks, '../lib/googleSignIn': googleSignIn, '../lib/joining': joining, '../lib/profile': { refreshProfileViews },
    '../lib/push': { subscriptionForAccount: async (_registration: unknown, id: string) => trace.push(['push-account', id]) },
    '../components/peekOverlay': { openCacheWithPeek: Null },
    '../components/AuthScreen': { AuthScreen: Container, AuthBrand: Null, SignInBox: Null, BrandMark: Null },
    '../components/Box': { Box: Container }, '../components/Cat': { Cat: Null }, '../components/MemberCats': { MemberCats: Null },
    '../components/Avatar': { Avatar: Null }, '../components/Stamp': { Stamp: Container },
    '../components/ThingTile': { ThingTile: Null, ThingStatus: Null }, '../components/Support': { SupportCard: Null },
    '../components/ProductTour': { ReplayTourButton: Null },
    '../components/Skeleton': { SkeletonRows: Null, LoadingStatus: Null, Shimmer: Null },
    '../components/skeletons/HomeSkeleton': { HomeBoxesSkeleton: Null },
    '../components/Turnstile': { Turnstile: Null }, '../components/FieldCheck': { FieldCheck }, '../components/CodeInput': { CodeInput: Null },
    '../components/GoogleSignInButton': { GoogleSignInButton: GoogleButton },
    '../components/LegalLinks': { LegalLinks: Null }, '../components/InviteBox': { InviteBox: Null },
    '../components/NamePreview': { NamePreview: Null }, '../components/CoatPicker': { CoatPicker: Null },
    '../components/InstallHint': { InstallHint: Null },
    '../lib/landingCopy': { landingCopy: { inviteNote: 'Saved invite hint' } },
    './OnboardingPage': { OnboardingPage: Null }, './LandingPage': { LandingPage: Null },
    './JoinInviteSheet': { JoinInviteSheet: Null }, './LoginPage': { LoginForm: Null },
    './PushControls': { PushControls: Null }, './ProfilePhotoControls': { ProfilePhotoControls: Null },
    '../components/CoatControls': { CoatControls: Null }, './ContactControls': { ContactControls: Null }, '../components/PeekControls': { PeekControls: Null },
  }
  vi.stubGlobal('location', { origin: 'https://communalcache.com', pathname: '/auth/link', search: '', hash: options.invalidLink ? '' : `#token=${'A'.repeat(32)}` })
  vi.stubGlobal('history', { state: null, replaceState: (...args: unknown[]) => trace.push(['history', ...args]) })
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({}) } })
  for (const name of ['sessionStorage', 'localStorage']) vi.stubGlobal(name, {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key),
  })
  const source = readFileSync(new URL(`../pages/${page}.tsx`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as Record<string, React.ComponentType<Record<string, unknown>>> }
  new Function('require', 'module', 'exports', compiled)((name: string) => { if (!(name in modules)) throw new Error(`Unexpected ${page} dependency ${name}`); return modules[name] }, module, module.exports)
  const Component = module.exports[page === 'LoginPage' ? 'LoginForm' : page]
  const props = page === 'JoinInviteSheet' ? { dialog: { current: dialog('join-invite-heading') } } : page === 'JoinRequests' ? { cacheId } : {}
  function render() {
    elements = []; queries.length = 0; stateIndex = 0; refIndex = 0
    const html = renderToStaticMarkup(createElement(Router.MemoryRouter, null, createElement(React.Fragment, null, createElement(Component, props), toasts.element())))
    for (const node of elements) {
      if (node.type === 'dialog') (node.props.ref as { current: unknown }).current = dialog(node.props['aria-labelledby'] as string)
      if (node.type === 'input' && node.props.id === 'email') (node.props.ref as { current: unknown }).current = email
      if (node.type === 'button' && node.props.ref) (node.props.ref as { current: unknown }).current = edit
      if (node.props.action === 'create_cache' || node.props.action === 'signin') (node.props.ref as { current: unknown }).current = bot
    }
    if (page === 'HomePage') refs[1].current = dialog('join-invite-heading')
    if (!mounted) { effects.forEach(effect => effect()); mounted = true }
    return html
  }
  function button(label: string) {
    const node = [...elements].reverse().find(node => node.type === 'button' && (nodeText(node) === label || node.props['aria-label'] === label))
    if (!node) throw new Error(`Missing ${page} button ${label}`)
    return node
  }
  function click(label: string) { lastAction = (button(label).props.onClick as () => unknown)(); render() }
  function change(id: string, value: unknown) {
    const node = elements.find(node => node.props.id === id || node.props.role === id)!
    ;(node.props.onChange as (event: unknown) => void)({ target: { value, checked: value } }); render()
  }
  function submit() {
    const form = elements.find(node => node.type === 'form')!
    lastAction = (form.props.onSubmit as (event: unknown) => unknown)({ preventDefault: vi.fn() })
    return lastAction
  }
  function escape(name: string) {
    const preventDefault = vi.fn()
    ;(dialogNode(name)?.props.onCancel as ((event: unknown) => void) | undefined)?.({ preventDefault })
    if (!preventDefault.mock.calls.length) dialog(name).close()
    return preventDefault
  }
  render()
  return {
    toasts, trace, render, queries, query, client, auth, email, bot, dialog, button, click, change, submit, escape,
    googleButton: () => elements.find(node => node.type === GoogleButton)!,
    field: (id: string) => elements.find(node => node.props.id === id)!,
    token(value = 'public-local-bot-token') { (elements.find(node => node.props.action === 'create_cache' || node.props.action === 'signin')!.props.onToken as (value: string) => void)(value); render() },
    botStatus(value: 'checking' | 'verified' | 'failed') { (elements.find(node => node.props.action === 'signin' || node.props.action === 'create_cache')!.props.onStatus as (value: string) => void)(value); render() },
    code(value: string) { (elements.find(node => node.props.onChange && node.props.value === '')!.props.onChange as (value: string) => void)(value); render() },
    settled: () => lastMutation, action: () => lastAction,
  }
}

it('Home retains action→create/join dialog ownership, Unicode name cap, idle Cancel/Escape and no writes', () => {
  const fetch = vi.spyOn(globalThis, 'fetch'), page = fixture('HomePage')
  page.click('New cache or join with an invite'); expect(page.dialog('cache-actions-heading').open).toBe(true)
  page.click('+ New cache'); expect(page.trace.slice(-2)).toEqual([['close', 'cache-actions-heading'], ['open', 'new-cache-heading']])
  expect(page.field('cache-name').props.autoFocus).toBe(true)
  page.change('cache-name', '😀'.repeat(61)); expect([...(page.field('cache-name').props.value as string)]).toHaveLength(60)
  page.click('Cancel'); expect(page.dialog('new-cache-heading').open).toBe(false)
  page.click('+ New cache'); expect(page.escape('new-cache-heading')).not.toHaveBeenCalled()
  page.click('Join with an invite'); expect(page.dialog('join-invite-heading').open).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
})

it('Home uses in-field verification with a toast and retry button, then resets feedback on close', () => {
  const fetch = vi.spyOn(globalThis, 'fetch'), page = fixture('HomePage')
  page.click('+ New cache')
  expect(page.render()).toContain('cc-field-check-checking')
  expect(page.render()).toContain('<span class="sr-only" role="status">Checking your browser…</span>')
  expect(page.render()).not.toContain('<p role="status"')
  expect(page.button('Create cache').props.disabled).toBe(true)
  page.submit(); expect(fetch).not.toHaveBeenCalled()
  page.botStatus('failed')
  expect(page.render()).toContain('cc-field-check-failed')
  expect(page.render()).toContain('role="alert"')
  expect(page.toasts.notice).toMatchObject({ message: "Couldn't verify your browser. Tap Try again.", tone: 'error' })
  expect(page.button('Try again').props).toMatchObject({ type: 'button', disabled: false })
  page.click('Try again'); expect(page.bot.retry).toHaveBeenCalledOnce()
  expect(fetch).not.toHaveBeenCalled()
  page.botStatus('verified'); page.token(); page.change('cache-name', 'Tools')
  expect(page.button('Create cache').props.disabled).toBe(false)
  expect(page.render()).not.toContain('cc-field-check')
  page.click('Cancel'); page.click('+ New cache')
  expect(page.render()).toContain('cc-field-check-checking')
  expect(page.button('Create cache').props.disabled).toBe(true)
})

it('Home creation retains pending Escape, 409 error/open state, retry and close→invalidate→navigate→bot reset order', async () => {
  let respond!: (response: Response) => void
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(resolve => { respond = resolve })).mockResolvedValueOnce(Response.json({ id: cacheId }))
  const page = fixture('HomePage'); page.click('+ New cache'); page.change('cache-name', 'Tools'); page.change('switch', true); page.token()
  page.submit(); page.render(); expect(page.button('Creating…').props.disabled).toBe(true); expect(page.escape('new-cache-heading')).toHaveBeenCalledOnce()
  respond(Response.json({ error: 'limit_reached', limit: 'owned_caches' }, { status: 409 })); await page.settled()
  expect(page.render()).toContain('Limit reached: you already own the maximum number of caches.')
  expect(page.dialog('new-cache-heading').open).toBe(true); expect(page.bot.reset).toHaveBeenCalledOnce()
  page.token(); page.trace.length = 0; page.submit(); await page.settled()
  expect(page.trace).toEqual([['close', 'new-cache-heading'], ['invalidate', ['caches']], ['navigate', `/caches/${cacheId}`], ['bot-reset']])
  expect(fetch.mock.calls[1]).toEqual(['/api/caches', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: '{"name":"Tools","requires_approval":true}', headers: expect.objectContaining({ 'X-Turnstile-Token': 'public-local-bot-token' }) })])
})

it('paste-invite keeps invalid input local, autofocus, close reset and close-before-navigation', () => {
  const fetch = vi.spyOn(globalThis, 'fetch'), page = fixture('JoinInviteSheet')
  expect(page.field('join-invite-code').props.autoFocus).toBe(true)
  page.change('join-invite-code', 'bad'); page.submit(); expect(page.render()).toContain('That does not look like an invite')
  expect(page.field('join-invite-code').props['aria-invalid']).toBe(true)
  page.change('join-invite-code', token); page.trace.length = 0; page.submit()
  expect(page.trace).toEqual([['close', 'join-invite-heading'], ['navigate', `/join/${token}`]])
  expect(page.render()).toContain('value=""'); expect(fetch).not.toHaveBeenCalled()
})

it('Account name Cancel restores focus without writing; save errors retain editor and success awaits refresh before focus', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ error: 'internal_error' }, { status: 503 })).mockResolvedValueOnce(Response.json(me))
  const page = fixture('AccountPage'); page.click('Edit display name'); expect(page.field('account-name').props.autoFocus).toBe(true)
  page.change('account-name', 'Changed'); page.click('Cancel'); expect(fetch).not.toHaveBeenCalled(); expect(page.trace.at(-1)).toEqual(['focus', 'edit-name'])
  page.click('Edit display name'); expect(page.field('account-name').props.value).toBe('Owner')
  page.change('account-name', 'Changed'); page.submit(); await page.settled(); expect(page.render()).toContain('Could not complete that request. Please try again.')
  expect(page.field('account-name').props.value).toBe('Changed'); page.trace.length = 0
  page.submit(); await page.settled(); expect(page.render()).not.toContain('id="account-name"')
  expect(page.trace).toEqual([...['me', 'cache', 'join-requests', ...requestKeys].map(key => ['invalidate', [key]]), ['focus', 'edit-name']])
  expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: '{"display_name":"Changed"}', credentials: 'same-origin' })
})

it('Account logout retains error/retry state without changing the signOut owner', async () => {
  const page = fixture('AccountPage')
  page.auth.signOut.mockRejectedValueOnce(new ApiError(503, 'internal_error'))
  page.click('Sign out'); await vi.waitFor(() => expect(page.render()).toContain('Could not complete that request. Please try again.'))
  page.click('Sign out'); await vi.waitFor(() => expect(page.auth.signOut).toHaveBeenCalledTimes(2))
  expect(page.trace.filter(row => row[0] === 'sign-out')).toEqual([['sign-out']])
})

it.each(['approve', 'reject'] as const)('join %s preserves exact POST and sequential invalidation even after a lost race', async decision => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ error: 'join_not_pending' }, { status: 409 })).mockResolvedValueOnce(Response.json({ status: decision }))
  const page = fixture('JoinRequests'); expect(page.queries[0].queryKey).toEqual(['join-requests', cacheId])
  page.click(decision === 'approve' ? 'Approve Neighbor' : 'Reject Neighbor'); page.render()
  expect(page.button('Approve Neighbor').props.disabled).toBe(true); expect(page.button('Reject Neighbor').props.disabled).toBe(true)
  await page.settled(); expect(page.render()).toContain('This join request has already been decided.')
  page.click(decision === 'approve' ? 'Approve Neighbor' : 'Reject Neighbor'); await page.settled()
  expect(page.render()).toContain('Join request decided.')
  expect(fetch.mock.calls[0]).toEqual([`/api/caches/${cacheId}/join-requests/member/${decision}`, expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: '{}' })])
  expect(page.trace).toEqual(Array.from({ length: 2 }, () => [['invalidate', ['join-requests', cacheId]], ['invalidate', ['cache', cacheId]], ['invalidate', ['caches']]]).flat())
})

it('uses an error toast for a Google callback failure without reflecting provider details', () => {
  const page = fixture('LoginPage', { googleError: true })
  expect(page.toasts.notice).toMatchObject({ message: googleSignIn.googleSignInError, tone: 'error' })
  expect(page.render()).not.toContain('private-provider-detail')
  expect(page.render()).toContain('cc-toast-error')
})

it('Login keeps bot checking inside the accessible email field and offers retry without blocking Google', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch'), page = fixture('LoginPage')
  expect(page.render()).toContain('<label for="email" class="sr-only">Email</label>')
  expect(page.render()).toContain('cc-field-check-checking')
  expect(page.render()).toContain('<span class="sr-only" role="status">Checking your browser…</span>')
  expect(page.render()).not.toContain('<p role="status"')
  expect(page.button('Email me a sign-in link').props.disabled).toBe(true)
  expect(page.googleButton().props.disabled).toBe(false)
  page.botStatus('failed')
  expect(page.render()).toContain('cc-field-check-failed')
  expect(page.render()).toContain('role="alert"')
  expect(page.toasts.notice).toMatchObject({ message: "Couldn't verify your browser. Tap Try again.", tone: 'error' })
  expect(page.button('Try again').props).toMatchObject({ type: 'button', disabled: false })
  expect(page.googleButton().props.disabled).toBe(false)
  expect(page.button('Use a 6-digit code instead').props.disabled).toBe(true)
  page.click('Try again'); expect(page.bot.retry).toHaveBeenCalledOnce()
  expect(fetch).not.toHaveBeenCalled()
  page.botStatus('verified'); page.token()
  expect(page.render()).not.toContain('cc-field-check')
  expect(page.button('Email me a sign-in link').props.disabled).toBe(false)
})

it('Login validates before send, retains errors, transitions link→code, verifies code then refreshes, and resets on wrong email', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ error: 'email_unavailable' }, { status: 502 })).mockImplementation(async () => Response.json({ success: true }))
  const page = fixture('LoginPage'); page.change('email', ' neighbor@example.test '); page.token()
  page.email.reportValidity.mockReturnValueOnce(false); await page.submit(); expect(fetch).not.toHaveBeenCalled()
  await page.submit(); expect(page.render()).toContain('Could not send the sign-in email')
  page.token(); await page.submit(); expect(page.render()).toContain('Check your email')
  page.token(); page.click('Use a 6-digit code instead'); await vi.waitFor(() => expect(page.render()).toContain('Enter your code'))
  const codeInput = page.field('email')
  expect(codeInput.props.readOnly).toBe(true)
  // The emitted CodeInput owns no local state: its onChange receives the code directly.
  page.code('123456'); await page.submit(); expect(page.auth.refresh).toHaveBeenCalledOnce()
  expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/auth/sign-in/magic-link', '/api/auth/sign-in/magic-link', '/api/auth/email-otp/send-verification-otp', '/api/auth/sign-in/email-otp'])
  expect(fetch.mock.calls.at(-1)?.[1]?.body).toBe('{"email":"neighbor@example.test","otp":"123456"}')
  page.click('Wrong email? Change it'); expect(page.trace.at(-1)).toEqual(['focus', 'email']); expect(page.render()).toContain('Email me a sign-in link')
})

it('Magic link never auto-verifies, scrubs history, and awaits centralized auth refresh before navigation', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: true, callback_url: 'https://communalcache.com/items' }))
  const page = fixture('MagicLinkPage')
  expect(fetch).not.toHaveBeenCalled(); expect(page.trace[0]).toEqual(['history', null, '', '/auth/link'])
  page.click('Continue'); await vi.waitFor(() => expect(page.trace.some(row => row[0] === 'navigate')).toBe(true))
  expect(page.trace.slice(1)).toEqual([['refresh'], ['navigate', '/items', { replace: true }]])
  expect(fetch.mock.calls[0][0]).toBe('/api/auth/magic-link/verify'); page.render(); expect(page.button('Continue').props.disabled).toBe(true)
})

it('Join preview remains separate from explicit join, and matching-token errors/success preserve invalidation and saved intent', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ error: 'limit_reached', limit: 'member_caches' }, { status: 409 })).mockResolvedValueOnce(Response.json({ cache_id: cacheId, name: 'Tools', status: 'pending' }))
  const page = fixture('JoinPage'); expect(page.queries[0]).toMatchObject({ queryKey: ['invite-preview', 'owner', token], enabled: true, retry: false, staleTime: 0, gcTime: 0 })
  expect(fetch).not.toHaveBeenCalled(); expect(pendingJoin.peekJoinToken()).toBe(token)
  page.click('Ask to join'); await page.settled(); expect(page.render()).toContain('Limit reached: you are already in the maximum number of caches.')
  expect(pendingJoin.peekJoinToken()).toBe(token)
  page.click('Ask to join'); await page.settled(); expect(page.render()).toContain('Waiting for owner approval')
  expect(pendingJoin.peekJoinToken()).toBeNull()
  expect(page.trace).toEqual([['invalidate', ['invite-preview', 'owner', token]], ['invalidate', ['caches']]])
  expect(fetch.mock.calls[1][0]).toBe(`/api/caches/${cacheId}/join`)
})

it('onboarding keeps name/coat PATCH and refresh sequencing', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(me)), page = fixture('OnboardingPage')
  page.change('display_name', 'New neighbor'); page.submit(); await page.settled()
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/me', expect.objectContaining({ method: 'PATCH', body: '{"display_name":"New neighbor","cat_coat":"grey"}', credentials: 'same-origin' }))
  expect(page.trace).toEqual([['refresh']])
})
