import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const base=readFileSync(new URL('../index.css',import.meta.url),'utf8')
const items=readFileSync(new URL('../items.css',import.meta.url),'utf8')
const roots='.organic-library, .organic-item-detail, .cc-owner-item-detail, .cc-item-editor, .cc-item-confirm'
const landing=readFileSync(new URL('../landing.css',import.meta.url),'utf8')
const profile=readFileSync(new URL('../profile.css',import.meta.url),'utf8')

it('defaults to system quiet roles while retaining brand assets without new downloads',()=>{
  expect(base).toContain('--font-heading-quiet: Georgia, serif;')
  expect(base).toContain('--font-ui: system-ui, sans-serif;')
  expect(base).toContain('--font-brand-heading: Caprasimo, system-ui, sans-serif;')
  expect(base).toContain('--font-brand-body: Figtree, system-ui, sans-serif;')
  expect(base).toContain('--font-heading: var(--font-heading-quiet);')
  expect(base).toContain('--font-body: var(--font-ui);')
  expect(base.match(/@font-face/g)).toHaveLength(4)
  expect(items).not.toMatch(/@font-face|url\(/)
})

it('preserves wordmark and landing/legal brand type and removes redundant item opt-ins',()=>{
  expect(base).toMatch(/\.cc-brand\s*\{[^}]*font: 400 17px\/24px var\(--font-brand-heading\)/)
  expect(profile).toMatch(/\.cc-auth-brand-link\s*\{[^}]*font: 400 20px var\(--font-brand-heading\)/)
  expect(landing).toMatch(/\.cc-landing\s*\{[^}]*--font-heading: var\(--font-brand-heading\);[^}]*--font-body: var\(--font-brand-body\);[^}]*font-family: var\(--font-body\)/)
  expect(landing).toContain('font-weight: 400 !important;')
  expect(items).not.toMatch(/--font-heading:|--font-body:|font-weight: 700 !important/)
  expect(base).toContain('h1, h2, h3, h4, h5, h6 {\n  font-family: var(--font-heading);\n  font-weight: 700 !important;')
  expect(base).toContain('):not(.cc-landing *) {\n  font-family: var(--font-body) !important;\n  font-weight: 700 !important;')
})

it('uses compact bold serif titles, bold sans actions and muted uppercase section labels',()=>{
  for(const [selector,size] of [['cc-library-header h1',26],['cc-owner-title h1',24],['cc-item-detail-title h1',24],['cc-item-editor-header h2',18],['cc-item-confirm h2',18]] as const){
    const rule=items.match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`))![1]
    expect(rule).toContain(`font: 700 ${size}px/`)
    expect(rule).toContain('var(--font-heading)')
  }
  expect(items).toContain(`:is(${roots}) :is(button:not(`)
  expect(items).toContain('font-size: 13px')
  const labels=items.slice(items.lastIndexOf('.cc-item-title-field > label'))
  for(const copy of ['.cc-owner-waiting > h2','font: 700 10.5px/1.4 var(--font-ui)','color: var(--cc-sub)','letter-spacing: .08em','text-transform: uppercase'])expect(labels).toContain(copy)
})
