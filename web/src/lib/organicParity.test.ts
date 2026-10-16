import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { BoxMark } from '../components/Box'

it('keeps every favicon shape identical to the in-app/exported flat brand mark', async () => {
  const generator = await import(new URL('../../../scripts/make-icons.mjs', import.meta.url).href)
  function shapes(svg: string) {
    return [...svg.matchAll(/<(path|rect)\b([^>]+)>/g)].map(match => ({
      tag: match[1],
      attrs: Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(attr => [attr[1], attr[2]])),
    }))
  }
  expect(shapes(generator.faviconSvg())).toEqual(shapes(renderToStaticMarkup(createElement(BoxMark, { size: 32 }))))
})

it('retains Organic geometry and touch targets for off-artboard confirmations and private editors', () => {
  const caches = readFileSync(new URL('../caches.css', import.meta.url), 'utf8')
  const profile = readFileSync(new URL('../profile.css', import.meta.url), 'utf8')
  expect(caches).toContain('.cc-cache-settings-page dialog { border: 0; border-radius: 32px; box-shadow: var(--cc-shadow); }')
  expect(caches).toContain('.cc-cache-settings-page dialog button { min-height: 44px;')
  expect(caches).toContain('nav[aria-label="Settings sections"] a { min-height: 44px; border-radius: 999px; }')
  expect(profile).toContain('#contact-sheet, #profile-photo-sheet { border: 0;')
  expect(profile).toContain('padding-bottom: max(24px,env(safe-area-inset-bottom,0px))')
  expect(profile).toContain('@media (min-width:640px) { #contact-sheet, #profile-photo-sheet { border-radius: 32px; } }')
})
