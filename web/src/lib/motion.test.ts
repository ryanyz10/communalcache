import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { readFileSync } from 'node:fs'
import { PixelHorizon } from '../components/PixelArt'
import { CACHE_OPEN_MS, bindTabMotion, bindWalker, fadeRoute, motionAllowed, openCache, plainLinkClick, walkerPose } from './motion'

function environment(reduced = false, hidden = false) {
  const docEvents = new Map<string, () => void>(), preferenceEvents = new Map<string, () => void>(), windowEvents = new Map<string, () => void>()
  const preference = { matches: reduced, addEventListener: vi.fn((name: string, listener: () => void) => preferenceEvents.set(name, listener)), removeEventListener: vi.fn((name: string) => preferenceEvents.delete(name)) }
  const root = { classList: { toggle: vi.fn(), remove: vi.fn() } }
  const doc = { hidden, documentElement: root, addEventListener: vi.fn((name: string, listener: () => void) => docEvents.set(name, listener)), removeEventListener: vi.fn((name: string) => docEvents.delete(name)) }
  const win = { addEventListener: vi.fn((name: string, listener: () => void) => windowEvents.set(name, listener)), removeEventListener: vi.fn((name: string) => windowEvents.delete(name)) }
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', win)
  vi.stubGlobal('matchMedia', vi.fn(() => preference))
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
  function tick(now: number) { const work = [...frames.values()]; frames.clear(); work.forEach(callback => callback(now)) }
  return { doc, preference, docEvents, preferenceEvents, windowEvents, root, frames, tick }
}
function link() {
  const attrs = new Map<string, string>()
  return { attrs, setAttribute: vi.fn((name: string, value: string) => attrs.set(name, value)), removeAttribute: vi.fn((name: string) => attrs.delete(name)) }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('navigates once after the 400ms stepped opening even when no animationend event arrives', () => {
  vi.useFakeTimers(); const view = environment(), anchor = link(), navigate = vi.fn()
  const cleanup = openCache(anchor as unknown as Element, navigate)
  expect(anchor.attrs.get('data-opening')).toBe('true')
  vi.advanceTimersByTime(CACHE_OPEN_MS - 1)
  expect(navigate).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(navigate).toHaveBeenCalledOnce()
  expect(anchor.attrs.has('data-opening')).toBe(false)
  expect(view.docEvents.size + view.preferenceEvents.size).toBe(0)
  cleanup?.(); vi.runAllTimers()
  expect(navigate).toHaveBeenCalledOnce()
})

it('skips all delay and opening state for reduced motion, hidden tabs and unsupported matchMedia', () => {
  for (const [reduced, hidden] of [[true,false],[false,true]]) {
    environment(reduced,hidden); const anchor = link(), navigate = vi.fn()
    expect(motionAllowed()).toBe(false)
    expect(openCache(anchor as unknown as Element,navigate)).toBeUndefined()
    expect(navigate).toHaveBeenCalledOnce()
    expect(anchor.setAttribute).not.toHaveBeenCalled()
  }
  vi.stubGlobal('matchMedia', undefined)
  const navigate = vi.fn()
  openCache(link() as unknown as Element,navigate)
  expect(navigate).toHaveBeenCalledOnce()
})

it('finishes pending navigation immediately if motion is reduced or the tab is hidden mid-opening', () => {
  vi.useFakeTimers()
  for (const reduce of [true,false]) {
    const view = environment(), navigate = vi.fn(), anchor = link()
    openCache(anchor as unknown as Element,navigate)
    if (reduce) { view.preference.matches = true; view.preferenceEvents.get('change')?.() }
    else { view.doc.hidden = true; view.docEvents.get('visibilitychange')?.() }
    expect(navigate).toHaveBeenCalledOnce()
    vi.runAllTimers()
    expect(navigate).toHaveBeenCalledOnce()
  }
})

it('cancels delayed navigation when a link unmounts after another route is chosen', () => {
  vi.useFakeTimers(); const view = environment(), anchor = link(), navigate = vi.fn()
  openCache(anchor as unknown as Element,navigate)?.()
  vi.runAllTimers()
  expect(navigate).not.toHaveBeenCalled()
  expect(anchor.attrs.size + view.docEvents.size + view.preferenceEvents.size).toBe(0)
})

it('handles pointer and keyboard-generated anchor clicks without stealing modifier/new-tab navigation', () => {
  const click = { button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }
  expect(plainLinkClick(click)).toBe(true)
  // Enter on a native anchor dispatches an unmodified button-0 click.
  expect(plainLinkClick({...click,button:0})).toBe(true)
  for (const change of [{button:1},{button:2},{defaultPrevented:true},{metaKey:true},{ctrlKey:true},{shiftKey:true},{altKey:true}]) expect(plainLinkClick({...click,...change})).toBe(false)
})

it('walks in integer pixels, pauses at either edge and turns without teleporting', () => {
  const travel = 10000, distance = 140
  expect(walkerPose(0,distance)).toEqual({x:0,direction:1,walking:true})
  expect(walkerPose(5000,distance)).toEqual({x:70,direction:1,walking:true})
  expect(walkerPose(travel+100,distance)).toEqual({x:140,direction:1,walking:false})
  expect(walkerPose(travel+1400,distance)).toEqual({x:140,direction:-1,walking:true})
  expect(walkerPose(travel*2+1500,distance)).toEqual({x:0,direction:-1,walking:false})
  expect(walkerPose(travel*2+2800,distance)).toEqual({x:0,direction:1,walking:true})
  for(let t=0;t<25000;t+=137) expect(Number.isInteger(walkerPose(t,distance).x)).toBe(true)
})

it('runs one walker RAF, stops while hidden, resumes without catch-up and becomes static under reduced motion', () => {
  const view = environment()
  const cat = { parentElement: {clientWidth:240}, getBoundingClientRect:()=>({width:24}), getClientRects:()=>[{}], style:{transform:''}, dataset:{walking:'false'} }
  const cleanup = bindWalker(cat as unknown as SVGSVGElement)
  expect(view.frames.size).toBe(1)
  view.tick(0); view.tick(1000)
  expect(cat.style.transform).toBe('translate3d(34px,0,0) scaleX(1)')
  view.doc.hidden = true; view.docEvents.get('visibilitychange')?.()
  expect(view.frames.size).toBe(0)
  view.doc.hidden = false; view.docEvents.get('visibilitychange')?.(); view.tick(99000)
  expect(cat.style.transform).toBe('translate3d(34px,0,0) scaleX(1)')
  view.preference.matches = true; view.preferenceEvents.get('change')?.()
  expect(view.frames.size).toBe(0)
  expect(cat.dataset.walking).toBe('false')
  expect(cat.style.transform).toBe('')
  cleanup()
  expect(view.docEvents.size + view.preferenceEvents.size + view.windowEvents.size).toBe(0)
})

it('does not start RAF for reduced motion or a responsive scene hidden by CSS', () => {
  const view = environment(true)
  const cat = { parentElement: {clientWidth:0}, getBoundingClientRect:()=>({width:24}), getClientRects:()=>[], style:{transform:''}, dataset:{walking:'false'} }
  const cleanup = bindWalker(cat as unknown as SVGSVGElement)
  expect(view.frames.size).toBe(0)
  view.preference.matches = false; view.preferenceEvents.get('change')?.()
  expect(view.frames.size).toBe(0)
  cleanup()
})

it('pauses CSS idle animations when hidden and fades route opacity for only 140ms, with live reduced-motion cancellation', () => {
  const view = environment(), unbind = bindTabMotion()
  expect(view.root.classList.toggle).toHaveBeenLastCalledWith('cc-motion-paused',false)
  view.doc.hidden = true; view.docEvents.get('visibilitychange')?.()
  expect(view.root.classList.toggle).toHaveBeenLastCalledWith('cc-motion-paused',true)
  unbind(); view.doc.hidden = false
  const animation = {cancel:vi.fn()}, content = {animate:vi.fn(()=>animation)}
  const cleanup = fadeRoute(content as unknown as HTMLElement)
  expect(content.animate).toHaveBeenCalledWith([{opacity:0.65},{opacity:1}],{duration:140,easing:'ease-out'})
  view.preference.matches = true; view.preferenceEvents.get('change')?.()
  expect(animation.cancel).toHaveBeenCalledOnce()
  cleanup?.()
  content.animate.mockClear()
  expect(fadeRoute(content as unknown as HTMLElement)).toBeUndefined()
  expect(content.animate).not.toHaveBeenCalled()
})

it('renders one walker per horizon and gates every CSS animation/transition behind no-preference', () => {
  const markup = renderToStaticMarkup(createElement(MemoryRouter,null,createElement(PixelHorizon,{kind:'boxes',entries:[{id:'cache',name:'Maple',to:'/caches/cache'}]})))
  expect(markup.match(/class="cc-walking-cat"/g)).toHaveLength(1)
  expect(markup).toContain('cc-walk-a')
  expect(markup).toContain('cc-walk-b')
  expect(markup).toContain('cc-box-lid')
  expect(markup).toContain('cc-cache-open')
  expect(markup).toContain('href="/caches/cache"')
  const css = readFileSync(new URL('../index.css',import.meta.url),'utf8')
  const enabled = css.split('@media (prefers-reduced-motion: no-preference) {')[1].split('@keyframes cc-lid-open')[0]
  for(const name of ['cc-lid-open','cc-cat-pop','cc-blink','cc-ear','cc-leg-a','cc-leg-b','cc-drift','cc-sheet-in']) expect(enabled).toContain(name)
  expect(css).not.toContain('to { x: 100%; }')
  for(const declaration of css.matchAll(/(?:animation|transition):[^;]+;/g)) {
    if(declaration[0]==='animation: none;') continue
    expect(enabled).toContain(declaration[0])
  }
})
