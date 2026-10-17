import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { Cat } from '../components/Cat'
import { Box, boxColor, BoxMark } from '../components/Box'
import { Stamp } from '../components/Stamp'
import { catHash, catTraits, COATS, PATTERNS } from './cats'

it('matches unsigned FNV-1a vectors and the exported Mia cat, using ids rather than names or emails', () => {
  expect(catHash('')).toBe(2166136261)
  expect(catHash('hello')).toBe(0x4f9f2cab)
  expect(catHash('Mia')).toBe(596915366)
  expect(catTraits('Mia')).toEqual({ coat: 'dusk', pattern: 'Solid', folded: false, tip: false, delay: 2.5 })
  expect(catHash('ryan@example.com')).toBe(0x99ea2f1a)
  expect(catTraits('ryan@example.com')).toEqual({ coat: 'ash', pattern: 'Tabby', folded: false, tip: false, delay: .7 })
  expect(catTraits('Mia')).toEqual(catTraits('Mia'))
  expect(catTraits('mia')).not.toEqual(catTraits('Mia'))
})

it('keeps all 120 trait combinations deterministic and bounded', () => {
  const combinations = new Set<string>()
  for (let index = 0; index < 10_000; index++) {
    const t = catTraits(`user-${index}`)
    expect(COATS.map(coat => coat.key)).toContain(t.coat)
    expect(PATTERNS).toContain(t.pattern)
    expect(t.delay).toBeGreaterThanOrEqual(0)
    expect(t.delay).toBeLessThan(3)
    combinations.add([t.coat, t.pattern, t.folded, t.tip].join(':'))
  }
  expect(combinations.size).toBe(120)
})

it('ports all three SVG poses, decorative semantics, exact geometry and source motion timings', () => {
  for (const [pose, viewBox] of [['sit', '0 0 60 80'], ['loaf', '0 0 100 50'], ['peek', '0 0 60 34']] as const) {
    const markup = renderToStaticMarkup(createElement(Cat, { userId: 'Mia', pose }))
    expect(markup).toContain(`viewBox="${viewBox}"`)
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('focusable="false"')
    expect(markup).toContain('overflow:visible')
    expect(markup).toContain('data-coat="dusk" data-pattern="Solid"')
    expect(markup).not.toContain('<rect x="0"')
    expect(renderToStaticMarkup(createElement(Cat, { userId: 'Mia', pose, motion: false }))).not.toContain('animation:')
  }
  expect(renderToStaticMarkup(createElement(Cat, { userId: 'Mia' }))).toContain('cc-blink 5.5s 2.5s infinite')
  const loaf = renderToStaticMarkup(createElement(Cat, { userId: 'Mia', pose: 'loaf' }))
  expect(loaf).toContain('cc-breathe 4.2s 2.5s')
  expect(loaf).toContain('cc-sway 3.6s 2.5s')
  expect(loaf).toContain('cc-z 4s')
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.cc-cat \*\s*\{\s*animation: none !important;\s*\}\s*\}/)
  for (const old of ['cc-walking-cat', 'cc-lid-open', 'cc-cat-pop', 'cc-drift']) expect(css).not.toContain(old)
})

it('renders the same cat from shared preview traits as from the authenticated user id and chosen coat', () => {
  for (const coat of COATS) for (const pose of ['sit','loaf','peek'] as const) for (const motion of [true,false]) {
    const props = { pose, motion }
    const signedIn = renderToStaticMarkup(createElement(Cat, { userId: 'Mia', coat: coat.key, ...props }))
    const preview = renderToStaticMarkup(createElement(Cat, { traits: catTraits('Mia',coat.key), ...props }))
    expect(preview).toBe(signedIn)
    expect(preview).not.toContain('Mia')
  }
})

it('draws stable cache-colored labelled boxes without turning a cache into a person or delaying links', () => {
  expect(boxColor('cache-id')).toBe(boxColor('cache-id'))
  expect(['#f6a06b', '#aebf92', '#dcd3c4']).toContain(boxColor('cache-id'))
  const box = renderToStaticMarkup(createElement(Box, { id: 'cache-id', label: 'Maple' }))
  expect(box).toContain('cc-box-handle')
  expect(box).toContain('cc-box-label">Maple')
  expect(box).not.toContain('cc-cat')
  const mark = renderToStaticMarkup(createElement(BoxMark))
  expect(mark).toContain('viewBox="0 0 32 32"')
  expect(mark).toContain('width="26" height="17" rx="5"')
  expect(mark).not.toContain('crispEdges')
  const stamp = renderToStaticMarkup(createElement(Stamp, { tone: 'ok', children: 'Approved' }))
  expect(stamp).toContain('cc-stamp cc-stamp-ok')
  expect(stamp).toContain('Approved')
})
