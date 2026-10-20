import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../auth/AuthProvider'
import { LoginForm } from '../pages/LoginPage'
import { Turnstile } from '../components/Turnstile'
import { FieldCheck } from '../components/FieldCheck'
import { apiFetch, ApiError, errorMessage, turnstileHeaders } from './api'
import { sendSignInEmail, verifyMagicLink } from './magicLinks'
import { mountTurnstile, turnstileTheme, type TurnstileApi } from './turnstile'

beforeEach(() => { vi.stubGlobal('sessionStorage',{getItem:()=>null,setItem:vi.fn(),removeItem:vi.fn()}) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function api() {
  return { render:vi.fn((_container:HTMLElement,_options:Parameters<TurnstileApi['render']>[1])=>'fixture-widget'),reset:vi.fn(),remove:vi.fn() }
}
function scripts() {
  const appended: {src:string;async:boolean;onload?:()=>void;onerror?:()=>void;remove:ReturnType<typeof vi.fn>}[] = []
  vi.stubGlobal('window',{})
  vi.stubGlobal('document',{createElement:()=>({src:'',async:false,remove:vi.fn()}),head:{appendChild:(script:typeof appended[number])=>appended.push(script)}})
  return appended
}

it('loads the explicit async provider script once for multiple widgets and resolves on load', async () => {
  vi.resetModules()
  const {loadTurnstile} = await import('./turnstile'), appended = scripts()
  const first = loadTurnstile(), second = loadTurnstile()
  expect(first).toBe(second)
  expect(appended).toHaveLength(1)
  expect(appended[0]).toMatchObject({src:'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',async:true})
  const provider = api(); window.turnstile = provider
  appended[0].onload?.()
  expect(await first).toBe(provider)
  expect(await loadTurnstile()).toBe(provider)
  expect(appended).toHaveLength(1)
})

it('never calls ready(), which the real provider rejects for async scripts', async () => {
  vi.resetModules()
  const {loadTurnstile} = await import('./turnstile'), appended = scripts()
  const ready = vi.fn(()=>{ throw new Error('turnstile.ready() would break') })
  const pending = loadTurnstile(), provider = {...api(),ready}
  window.turnstile = provider; appended[0].onload?.()
  expect(await pending).toBe(provider)
  expect(ready).not.toHaveBeenCalled()
})

it('uses an already-present API without injecting another script', async () => {
  vi.resetModules()
  const {loadTurnstile} = await import('./turnstile'), appended = scripts(), provider = api()
  window.turnstile = provider
  expect(await loadTurnstile()).toBe(provider)
  expect(appended).toHaveLength(0)
})

it('fails and allows retry when the script loads without exposing the API', async () => {
  vi.resetModules()
  const {loadTurnstile} = await import('./turnstile'), appended = scripts()
  const failed = expect(loadTurnstile()).rejects.toThrow('Bot check could not load')
  appended[0].onload?.(); await failed
  expect(appended[0].remove).toHaveBeenCalledOnce()
  const retry = loadTurnstile(), provider = api()
  window.turnstile = provider; appended[1].onload?.()
  expect(await retry).toBe(provider)
})

it('uses the owner-approved shared sitekey with separate exact production/staging hostnames and no secret values', () => {
  const config=JSON.parse(readFileSync(new URL('../../../wrangler.jsonc',import.meta.url),'utf8'))
  for(const vars of [config.vars,config.env.production.vars,config.env.staging.vars]) {
    expect(vars.TURNSTILE_SITE_KEY).toBe('0x4AAAAAAFX8jA_m3iHxQbuL')
    expect(vars).not.toHaveProperty('TURNSTILE_SECRET')
  }
  expect(config.vars.TURNSTILE_HOSTNAMES).toBe('communalcache.com')
  expect(config.env.production.vars.TURNSTILE_HOSTNAMES).toBe('communalcache.com')
  expect(config.env.staging.vars.TURNSTILE_HOSTNAMES).toBe('communalcache-staging.ryanyz10-be6.workers.dev')
  const local=readFileSync(new URL('../../../.dev.vars.example',import.meta.url),'utf8')
  expect(local).toContain('TURNSTILE_SECRET=\n')
  expect(local).toContain('TURNSTILE_HOSTNAMES=localhost')
})

it('recovers from a blocked script and bounds loading at fifteen seconds', async () => {
  vi.useFakeTimers(); vi.resetModules()
  const {loadTurnstile} = await import('./turnstile'), appended = scripts()
  const failed = expect(loadTurnstile()).rejects.toThrow('Bot check could not load')
  appended[0].onerror?.(); await failed
  expect(appended[0].remove).toHaveBeenCalledOnce()
  const pending = expect(loadTurnstile()).rejects.toThrow('Bot check could not load')
  expect(appended).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(15_000)
  await pending
  expect(appended[1].remove).toHaveBeenCalledOnce()
})

it.each(['signin','create_cache'] as const)('renders the %s action, resets one-use tokens, clears failures and ignores removed-widget callbacks', action => {
  const provider = api(), onToken = vi.fn(), onError = vi.fn(), container = {} as HTMLElement
  const widget = mountTurnstile(provider,container,'1x00000000000000000000AA',action,'dark',onToken,onError)
  const options = provider.render.mock.calls[0][1]
  expect(options).toMatchObject({sitekey:'1x00000000000000000000AA',action,theme:'dark',appearance:'interaction-only',retry:'never'})
  options.callback('one-use-token'); expect(onToken).toHaveBeenLastCalledWith('one-use-token')
  widget.reset(); expect(provider.reset).toHaveBeenCalledWith('fixture-widget'); expect(onToken).toHaveBeenLastCalledWith('')
  options['expired-callback'](); expect(onError).toHaveBeenLastCalledWith('Bot check expired. Please retry.')
  options['timeout-callback'](); expect(onError).toHaveBeenLastCalledWith('Bot check timed out. Please retry.')
  expect(options['error-callback']()).toBe(true); expect(onError).toHaveBeenLastCalledWith('Bot check failed. Please retry.')
  options.callback('fresh-token'); expect(onError).toHaveBeenLastCalledWith('')
  widget.remove(); expect(provider.remove).toHaveBeenCalledWith('fixture-widget')
  onToken.mockClear(); options.callback('stale-token'); options['expired-callback'](); widget.reset()
  expect(onToken).not.toHaveBeenCalled()
})

it('uses the rendered cozy palette rather than a fixture-incompatible browser default', () => {
  vi.stubGlobal('document',{documentElement:{}})
  const computed = vi.fn(()=>({colorScheme:'dark'})); vi.stubGlobal('getComputedStyle',computed)
  expect(turnstileTheme()).toBe('dark')
  computed.mockReturnValue({colorScheme:'light'}); expect(turnstileTheme()).toBe('light')
})

it('passes tokens in headers for both email sends and cache creation but never gates Continue verification', async () => {
  const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async()=>Response.json({success:true}))
  await sendSignInEmail(' own@example.test ','link',undefined,'link-token')
  expect(fetch).toHaveBeenLastCalledWith('/api/auth/sign-in/magic-link',expect.objectContaining({headers:expect.objectContaining({'X-Turnstile-Token':'link-token'}),body:JSON.stringify({email:'own@example.test'})}))
  await sendSignInEmail('own@example.test','code',undefined,'code-token')
  expect(fetch).toHaveBeenLastCalledWith('/api/auth/email-otp/send-verification-otp',expect.objectContaining({headers:expect.objectContaining({'X-Turnstile-Token':'code-token'}),body:JSON.stringify({email:'own@example.test',type:'sign-in'})}))
  await apiFetch('/api/caches',{body:{name:'Tools'},turnstileToken:'cache-token'})
  expect(fetch).toHaveBeenLastCalledWith('/api/caches',expect.objectContaining({headers:expect.objectContaining({'X-Turnstile-Token':'cache-token'}),body:JSON.stringify({name:'Tools'})}))
  await verifyMagicLink({token:'A'.repeat(32),callbackURL:'/',newUserCallbackURL:'/',errorCallbackURL:'/'})
  expect(fetch.mock.calls.at(-1)?.[1]?.headers).not.toHaveProperty('X-Turnstile-Token')
})

it('rejects absent/oversized client tokens before sending and provides clear server rejection copy', async () => {
  const fetch = vi.spyOn(globalThis,'fetch')
  for(const token of ['',' ','x'.repeat(2049)]) {
    expect(()=>turnstileHeaders(token)).toThrow(ApiError)
    await expect(apiFetch('/api/caches',{body:{name:'Tools'},turnstileToken:token})).rejects.toMatchObject({code:'turnstile_failed'})
  }
  expect(fetch).not.toHaveBeenCalled()
  expect(turnstileHeaders('x'.repeat(2048))).toHaveProperty('X-Turnstile-Token')
  expect(errorMessage(new ApiError(403,'turnstile_failed'))).toContain('complete the new check')
})

it('shares theme-aware field feedback with static reduced-motion checking and room for the name count', () => {
  expect(renderToStaticMarkup(createElement(FieldCheck,{status:'verified'}))).toBe('')
  const checking = renderToStaticMarkup(createElement(FieldCheck,{status:'checking'}))
  expect(checking).toContain('cc-field-check-checking')
  expect(checking).toContain('aria-hidden="true"')
  expect(renderToStaticMarkup(createElement(FieldCheck,{status:'failed'}))).toContain('cc-field-check-failed')
  const css = readFileSync(new URL('../profile.css',import.meta.url),'utf8')
  expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.cc-field-check-checking svg \{\s*animation: cc-field-check-spin/)
  const cacheCss = readFileSync(new URL('../caches.css',import.meta.url),'utf8')
  expect(cacheCss).toMatch(/#cache-name-count \{\s*position: absolute;\s*right: 50px/)
  expect(cacheCss).toContain('padding-right: 112px')
})

it('keeps initial email-send actions disabled until a token exists and leaves feedback to the caller', () => {
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}})
  client.setQueryData(['me'],null)
  const markup = renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(MemoryRouter,null,createElement(LoginForm))})))
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Email me a sign-in link<\/button>/)
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Use a 6-digit code instead<\/button>/)
  client.setQueryData(['config'],{turnstile_site_key:''})
  const unavailable = renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(Turnstile,{action:'signin',onToken:()=>{}})))
  expect(unavailable).toContain('aria-label="Bot protection"')
  expect(unavailable).not.toContain('Bot protection is unavailable')
  expect(unavailable).not.toContain('Retry bot check')
  client.clear()
})
