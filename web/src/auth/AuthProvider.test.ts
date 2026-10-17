import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { apiFetch, ApiError, errorMessage, type Me } from '../lib/api'
import * as push from '../lib/push'
import { clearJoinToken } from '../lib/pendingJoin'
import { setSessionHint } from '../lib/sessionHint'

type Auth = { ready: boolean; me: Me | null; refresh: () => Promise<void>; signOut: () => Promise<void> }
const A = { id: 'account-A', email: 'a@example.test', display_name: 'A' }
const B = { id: 'account-B', email: 'b@example.test', display_name: 'B' }
const compiled = ts.transpileModule(readFileSync(new URL('./AuthProvider.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function browser(broadcast = true) {
  let session: Me | null = A
  const values = new Map<string, string>([[push.PUSH_OWNER_KEY, A.id]])
  const cacheValues = new Map<string, Response>()
  const cache = {
    put: vi.fn(async (key: string, value: Response) => { cacheValues.set(key, value) }),
    delete: vi.fn(async (key: string) => cacheValues.delete(key)),
  }
  let live = true
  const subscription = { endpoint: 'https://fcm.googleapis.com/browser', unsubscribe: vi.fn(async () => { live = false; return true }) }
  const registration = { pushManager: { getSubscription: vi.fn(async () => live ? subscription : null) }, getNotifications: vi.fn(async () => []) }
  const permission = vi.fn()
  const getRegistration = vi.fn(async () => registration)
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration } })
  vi.stubGlobal('Notification', { requestPermission: permission })
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) })
  vi.stubGlobal('sessionStorage', { getItem: () => null, removeItem: vi.fn() })
  const localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { values.set(key, value) }), removeItem: (key: string) => { values.delete(key) } }
  vi.stubGlobal('localStorage', localStorage)
  const peers = new Set<Channel>()
  class Channel {
    onmessage: ((event: { data: unknown }) => void) | null = null
    constructor() { peers.add(this) }
    postMessage(data: unknown) { for (const peer of peers) if (peer !== this) queueMicrotask(() => peer.onmessage?.({ data })) }
    close() { peers.delete(this) }
  }
  vi.stubGlobal('BroadcastChannel', broadcast ? Channel : undefined)
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path) => {
    if (path === '/api/me') return session ? Response.json(session) : Response.json({ error: 'unauthorized' }, { status: 401 })
    if (path === '/api/auth/sign-out') session = null
    return new Response(null, { status: 204 })
  })
  return { cacheValues, fetch, subscription, registration, getRegistration, permission, localStorage, setSession: (me: Me | null) => { session = me } }
}

// Drive the real provider hooks with real QueryObserver/QueryClient lifecycles, without a DOM dependency.
function tab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  const page = new EventTarget() as EventTarget & { visibilityState: string }
  page.visibilityState = 'visible'
  const window = new EventTarget()
  const hooks: { value?: unknown; deps?: unknown[]; cleanup?: () => void }[] = []
  let index = 0, queued = false, closed = false, auth!: Auth
  let observer: QueryObserver<Me | null> | undefined
  const effects: (() => void)[] = []
  function schedule() {
    if (queued || closed) return
    queued = true
    queueMicrotask(() => { queued = false; if (!closed) render() })
  }
  function memo(value: unknown, deps: unknown[]) {
    const hook = hooks[index] ?? (hooks[index] = {})
    if (!hook.deps || deps.some((dep, i) => dep !== hook.deps![i])) { hook.value = value; hook.deps = deps }
    index++
    return hook.value
  }
  const modules: Record<string, unknown> = {
    react: {
      createContext: () => ({ Provider: 'provider' }),
      useRef: (initial: unknown) => { const hook = hooks[index] ?? (hooks[index] = { value: { current: initial } }); index++; return hook.value },
      useState: (initial: unknown) => {
        const hook = hooks[index] ?? (hooks[index] = { value: initial }); index++
        return [hook.value, (value: unknown) => { if (value !== hook.value) { hook.value = value; schedule() } }]
      },
      useCallback: memo,
      useEffect: (effect: () => (() => void), deps: unknown[]) => {
        const hook = hooks[index] ?? (hooks[index] = {}); index++
        if (!hook.deps || deps.some((dep, i) => dep !== hook.deps![i])) {
          hook.deps = deps
          effects.push(() => { hook.cleanup?.(); hook.cleanup = effect() })
        }
      },
    },
    'react/jsx-runtime': { jsx: (_type: unknown, props: { value: Auth }) => { auth = props.value } },
    '@tanstack/react-query': {
      useQueryClient: () => client,
      useQuery: (options: ConstructorParameters<typeof QueryObserver<Me | null>>[1]) => {
        if (!observer) observer = new QueryObserver(client, options)
        else observer.setOptions(options)
        return observer.getCurrentResult()
      },
    },
    '../lib/api': { apiFetch, ApiError, errorMessage }, '../lib/push': push,
    '../lib/pendingJoin': { clearJoinToken }, '../lib/sessionHint': { setSessionHint },
  }
  const module = { exports: {} as { AuthProvider: (props: { children: null }) => unknown } }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`)
    return modules[name]
  }, module, module.exports)
  function render() {
    vi.stubGlobal('document', page); vi.stubGlobal('window', window)
    index = 0
    module.exports.AuthProvider({ children: null })
    effects.splice(0).forEach(effect => effect())
  }
  render()
  const unsubscribe = observer!.subscribe(schedule)
  render()
  cleanups.push(() => { closed = true; unsubscribe(); hooks.forEach(hook => hook.cleanup?.()); client.clear() })
  return {
    client, get auth() { return auth },
    async ready(id: string | null) { await vi.waitFor(() => { expect(auth.ready).toBe(true); expect(auth.me?.id ?? null).toBe(id) }) },
    visibility(state: string) { page.visibilityState = state; page.dispatchEvent(new Event('visibilitychange')) },
    storage(value: string) { const event = new Event('storage'); Object.assign(event, { key: 'communalcache-session', newValue: value }); window.dispatchEvent(event) },
  }
}

it('two-tab sign-out clears private state, cancels in-flight queries and retains public config', async () => {
  const env = browser(), first = tab(), second = tab()
  await first.ready(A.id); await second.ready(A.id)
  for (const current of [first, second]) {
    current.client.setQueryData(['caches'], ['A private cache'])
    current.client.setQueryData(['request-contact', A.id], { value: 'private contact' })
    current.client.setQueryData(['config'], { public: true })
  }
  let aborted = false, finish!: () => void
  const pending = second.client.fetchQuery({ queryKey: ['slow-private'], queryFn: ({ signal }) => new Promise(resolve => {
    signal.addEventListener('abort', () => { aborted = true })
    finish = () => resolve('late A data')
  }) }).catch(() => {})
  await first.auth.signOut()
  await first.ready(null); await second.ready(null)
  finish(); await pending
  expect(aborted).toBe(true)
  for (const current of [first, second]) {
    expect(current.client.getQueryData(['caches'])).toBeUndefined()
    expect(current.client.getQueryData(['request-contact', A.id])).toBeUndefined()
    expect(current.client.getQueryData(['slow-private'])).toBeUndefined()
    expect(current.client.getQueryData(['config'])).toEqual({ public: true })
  }
  expect(env.cacheValues.has('/__push-account')).toBe(false)
})

it.each(['OTP', 'magic link', 'Google'] as const)('%s A→B clears the other tab and reconciles push without Account or permission', async method => {
  const env = browser(), first = tab(), second = tab()
  await first.ready(A.id); await second.ready(A.id)
  first.client.setQueryData(['caches'], ['A private cache'])
  second.client.setQueryData(['requests'], ['A private request'])
  env.setSession(B)
  // OTP/Continue await refresh; Google returns to a fresh app mount.
  if (method === 'Google') await tab().ready(B.id)
  else await first.auth.refresh()
  await first.ready(B.id); await second.ready(B.id)
  expect(first.client.getQueryData(['caches'])).toBeUndefined()
  expect(second.client.getQueryData(['requests'])).toBeUndefined()
  expect(env.subscription.unsubscribe).toHaveBeenCalled()
  expect(env.permission).not.toHaveBeenCalled()
  expect(await env.cacheValues.get('/__push-account')!.clone().text()).toBe(B.id)
})

it('an aborted old reconciliation cannot unsubscribe or overwrite a newer account after service-worker I/O', async () => {
  const env = browser()
  let resume!: (registration: typeof env.registration) => void
  env.getRegistration.mockImplementationOnce(async () => new Promise(resolve => { resume = resolve }))
  const current = tab()
  await vi.waitFor(() => expect(resume).toBeDefined())
  env.setSession(B)
  await current.auth.refresh(); await current.ready(B.id)
  env.localStorage.setItem(push.PUSH_OWNER_KEY, B.id)
  env.subscription.unsubscribe.mockClear()
  resume(env.registration)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(env.subscription.unsubscribe).not.toHaveBeenCalled()
  expect(env.localStorage.getItem(push.PUSH_OWNER_KEY)).toBe(B.id)
  expect(await env.cacheValues.get('/__push-account')!.clone().text()).toBe(B.id)
})

it('hides private views on visibility return until session revalidation completes, even without BroadcastChannel', async () => {
  const env = browser(false), current = tab()
  await current.ready(A.id)
  current.client.setQueryData(['caches'], ['A private cache'])
  current.visibility('hidden')
  await vi.waitFor(() => expect(current.auth.ready).toBe(false))
  let respond!: (value: Response) => void
  env.fetch.mockImplementationOnce(async () => new Promise<Response>(resolve => { respond = resolve }))
  current.visibility('visible')
  await vi.waitFor(() => expect(respond).toBeDefined())
  expect(current.auth.ready).toBe(false)
  expect(current.auth.me).toBeNull()
  respond(Response.json(B)); await current.ready(B.id)
  expect(current.client.getQueryData(['caches'])).toBeUndefined()
  expect(env.localStorage.setItem.mock.calls.some(([key]) => key === 'communalcache-session')).toBe(true)
})

it('storage fallback only uses peer identity as a revalidation hint and fails closed on a 401', async () => {
  const env = browser(false), current = tab()
  await current.ready(A.id)
  current.client.setQueryData(['caches'], ['A private cache'])
  env.setSession(null)
  current.storage(JSON.stringify({ type: 'session-changed', userId: B.id }))
  await current.ready(null)
  expect(current.client.getQueryData(['caches'])).toBeUndefined()
  expect(env.cacheValues.has('/__push-account')).toBe(false)
})
