import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const base=readFileSync(new URL('../index.css',import.meta.url),'utf8')
const items=readFileSync(new URL('../items.css',import.meta.url),'utf8')
const roots='.organic-library, .organic-item-detail, .cc-owner-item-detail, .cc-item-editor, .cc-item-confirm'

it('adds local-system quiet tokens without replacing brand tokens or adding font downloads',()=>{
  expect(base).toContain('--font-heading-quiet: Georgia, serif;')
  expect(base).toContain('--font-ui: system-ui, sans-serif;')
  expect(base).toContain('--font-heading: Caprasimo, system-ui, sans-serif;')
  expect(base).toContain('--font-body: Figtree, system-ui, sans-serif;')
  expect(base.match(/@font-face/g)).toHaveLength(4)
  expect(items).not.toMatch(/@font-face|url\(/)
})

it('opts only existing item roots into quiet headings and system body text',()=>{
  const alias=items.match(/([^{}]+)\{\s*--font-heading: var\(--font-heading-quiet\);\s*--font-body: var\(--font-ui\);\s*font-family: var\(--font-ui\);\s*\}/)!
  expect(alias).not.toBeNull()
  expect(alias[1].trim().split('\n').at(-1)).toBe(roots)
  expect(items.match(/--font-heading: /g)).toHaveLength(1)
  expect(items.match(/--font-body: /g)).toHaveLength(1)
  expect(base).not.toContain('var(--font-heading-quiet)')
  expect(base).not.toContain('var(--font-ui)')
})

it('uses compact bold serif titles, bold sans actions and muted uppercase section labels',()=>{
  for(const [selector,size] of [['cc-library-header h1',26],['cc-owner-title h1',24],['cc-item-detail-title h1',24],['cc-item-editor-header h2',18],['cc-item-confirm h2',18]] as const){
    const rule=items.match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`))![1]
    expect(rule).toContain(`font: 700 ${size}px/`)
    expect(rule).toContain('var(--font-heading)')
  }
  expect(items).toContain(`:is(${roots}) :is(h1, h2, h3) {\n  font-weight: 700 !important;`)
  const actions=items.slice(items.lastIndexOf(`:is(${roots}) :is(button,`))
  expect(actions).toContain('font-family: var(--font-ui)')
  expect(actions).toContain('font-weight: 700')
  expect(actions).toContain('font-size: 13px')
  const labels=items.slice(items.lastIndexOf('.cc-item-title-field > label'))
  for(const copy of ['.cc-owner-waiting > h2','font: 700 10.5px/1.4 var(--font-ui)','color: var(--cc-sub)','letter-spacing: .08em','text-transform: uppercase'])expect(labels).toContain(copy)
})
