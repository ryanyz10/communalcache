import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ReactElement, type ReactNode } from 'react'
import * as React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import * as Router from 'react-router'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { Cat } from '../components/Cat'
import { landingCopy, SOURCE_CODE_URL } from './landingCopy'
import { siteTitle } from './siteName'

type Element = ReactElement<Record<string, unknown>>
afterEach(() => vi.restoreAllMocks())

function fixture() {
  let open: number | null = 0, elements: Element[] = []
  const record = (factory: typeof jsx) => (...args: Parameters<typeof jsx>) => {
    const element = factory(...args); elements.push(element as Element); return element
  }
  const Null = () => null
  const modules: Record<string, unknown> = {
    react: { ...React, useEffect: () => {}, useState: () => [open, (update: (value: number | null) => number | null) => { open = update(open) }] },
    'react/jsx-runtime': { jsx: record(jsx), jsxs: record(jsxs) },
    'react-router': Router,
    '../components/Box': { BoxMark: Null }, '../components/Cat': { Cat },
    '../components/Support': { SupportLink: Null }, '../components/LegalLinks': { LegalLinks: Null },
    '../lib/landingCopy': { landingCopy, SOURCE_CODE_URL }, '../lib/siteName': { siteTitle },
  }
  const source = readFileSync(new URL('../pages/LandingPage.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as { LandingPage: React.ComponentType } }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected landing dependency: ${name}`)
    return modules[name]
  }, module, module.exports)
  function render() {
    elements = []
    return renderToStaticMarkup(createElement(Router.MemoryRouter, null, createElement(module.exports.LandingPage)))
  }
  const buttons = () => elements.filter(node => node.type === 'button' && String(node.props.id).startsWith('landing-faq-question-'))
  const panels = () => elements.filter(node => node.props.role === 'region' && String(node.props.id).startsWith('landing-faq-answer-'))
  render()
  return { render, buttons, panels }
}
function text(node: ReactNode): string {
  return React.Children.toArray(node).map(child => React.isValidElement(child) ? text((child as Element).props.children as ReactNode) : String(child)).join('')
}

it('renders all six export questions with labelled controls, hidden collapsed panels and a decorative loaf cat', () => {
  const page = fixture(), markup = page.render()
  expect(landingCopy.faq.items.map(item => item.question)).toEqual([
    'What’s a cache?', 'Who can see my things?', 'How do I join one?',
    'What happens when someone asks for my thing?', 'What if something breaks or doesn’t come back?', 'Does it cost anything?',
  ])
  expect(page.buttons()).toHaveLength(6)
  expect(page.panels()).toHaveLength(6)
  expect(markup).toContain('aria-labelledby="landing-faq-heading"')
  expect(markup).toContain('Questions, unpacked')
  expect(markup).toContain('Tap a box to open it.')
  expect(markup).toContain('class="cc-landing-faq-cat" aria-hidden="true"')
  expect(markup).toContain('cc-cat cc-cat-loaf')
  for (const [index, button] of page.buttons().entries()) {
    const panel = page.panels()[index]
    expect(button.props.type).toBe('button')
    expect(text(button.props.children as ReactNode)).toBe(landingCopy.faq.items[index].question)
    expect(button.props['aria-controls']).toBe(panel.props.id)
    expect(panel.props['aria-labelledby']).toBe(button.props.id)
    expect(button.props['aria-expanded']).toBe(index === 0)
    expect(panel.props['aria-hidden']).toBe(index !== 0)
    expect(panel.props.inert).toBe(index !== 0)
  }
})

it('opens only one answer at a time and permits closing the open answer', () => {
  const page = fixture()
  const expanded = () => page.buttons().map(button => button.props['aria-expanded'])
  expect(expanded()).toEqual([true, false, false, false, false, false])
  ;(page.buttons()[3].props.onClick as () => void)(); page.render()
  expect(expanded()).toEqual([false, false, false, true, false, false])
  expect(page.panels().map(panel => panel.props['aria-hidden'])).toEqual([true, true, true, false, true, true])
  ;(page.buttons()[3].props.onClick as () => void)(); page.render()
  expect(expanded()).toEqual([false, false, false, false, false, false])
  ;(page.buttons()[5].props.onClick as () => void)(); page.render()
  expect(expanded()).toEqual([false, false, false, false, false, true])
})

it('keeps theme-token box fills, the export layout, expand motion and reduced-motion override', () => {
  const css = readFileSync(new URL('../landing.css', import.meta.url), 'utf8')
  const faq = css.slice(css.indexOf('.cc-landing-faq {'), css.indexOf('.cc-landing-bottom {'))
  expect(faq).toContain('gap: 40px 56px')
  expect(faq).toContain('flex: 2 1 420px')
  expect(faq).toContain('var(--cc-card)')
  expect(faq).toContain('var(--cc-sub)')
  expect(faq).not.toMatch(/#f6a06b|#aebf92|#ffc6a5/)
  expect(faq).toContain('grid-template-rows: 0fr')
  expect(faq).toContain('grid-template-rows: 1fr')
  expect(faq).toContain('rotate(135deg)')
  expect(css).toContain('@media (prefers-reduced-motion:reduce)')
  expect(css).toContain('.cc-landing-faq-answer, .cc-landing-faq-icon {\n    transition: none;')
})
