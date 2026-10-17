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
  expect(caches).toMatch(/\.cc-cache-settings-page dialog\s*\{\s*border: 0;\s*border-radius: 32px;\s*box-shadow: var\(--cc-shadow\);\s*\}/)
  expect(caches).toMatch(/\.cc-cache-settings-page dialog button\s*\{\s*min-height: 44px;/)
  expect(caches).toMatch(/nav\[aria-label="Settings sections"\] a\s*\{\s*min-height: 44px;\s*border-radius: 999px;\s*\}/)
  expect(profile).toMatch(/#contact-sheet, #profile-photo-sheet\s*\{\s*border: 0;/)
  expect(profile).toContain('padding-bottom: max(24px,env(safe-area-inset-bottom,0px))')
  expect(profile).toMatch(/@media \(min-width:640px\)\s*\{\s*#contact-sheet, #profile-photo-sheet\s*\{\s*border-radius: 32px;\s*\}\s*\}/)
})
