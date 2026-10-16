import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPeekMode, markPeeked, setPeekMode, shouldPeek } from './peek'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }))
})
afterEach(() => vi.unstubAllGlobals())

it('plays every time by default', () => {
  markPeeked('a')
  expect(shouldPeek('a')).toBe(true)
})

it('never plays when the device asks for reduced motion', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }))
  expect(shouldPeek('a')).toBe(false)
  setPeekMode('first')
  expect(shouldPeek('a')).toBe(false)
})

it('first-time mode plays once per cache', () => {
  setPeekMode('first')
  expect(getPeekMode()).toBe('first')
  expect(shouldPeek('a')).toBe(true)
  markPeeked('a')
  expect(shouldPeek('a')).toBe(false)
  expect(shouldPeek('b')).toBe(true)
  setPeekMode('always')
  expect(getPeekMode()).toBe('always')
  expect(shouldPeek('a')).toBe(true)
})

it('never mode never plays', () => {
  setPeekMode('never')
  expect(getPeekMode()).toBe('never')
  expect(shouldPeek('a')).toBe(false)
})

it('treats corrupt or blocked storage as every-time without throwing', () => {
  store.set('cc_peek_seen', '{not json')
  setPeekMode('first')
  expect(shouldPeek('a')).toBe(true)
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } })
  expect(() => { markPeeked('a'); setPeekMode('first') }).not.toThrow()
  expect(shouldPeek('a')).toBe(true)
})
