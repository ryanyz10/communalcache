import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { siteMetadataPlugin } from '../../vite.config'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

it.each([
  ['Communal Cache', 'Communal Cache'],
  ['Communal Cache Staging', 'CC Staging'],
] as const)('emits %s HTML and installed-app metadata while preserving manifest identity and assets', (name, shortName) => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const template = JSON.parse(readFileSync(new URL('../../public/manifest.webmanifest', import.meta.url), 'utf8'))
  const plugin = siteMetadataPlugin(name)
  const transformed = plugin.transformIndexHtml(html)
  expect(transformed).toContain(`<title>${name}</title>`)
  expect(transformed).toContain(`name="apple-mobile-web-app-title" content="${shortName}"`)
  if (name === 'Communal Cache') expect(transformed).toBe(html)
  let output!: { type: 'asset'; fileName: string; source: string }
  plugin.generateBundle.call({ emitFile(asset) { output = asset } })
  expect(output.fileName).toBe('manifest.webmanifest')
  expect(JSON.parse(output.source)).toEqual({ ...template, name, short_name: shortName })
  expect(JSON.parse(output.source)).toMatchObject({ id: '/', scope: '/', start_url: '/' })
})

it.each([undefined, 'Communal Cache Staging'])('keeps runtime title overrides aligned with site name %s without changing wordmark copy', async name => {
  vi.stubEnv('VITE_SITE_NAME', name)
  vi.resetModules()
  const { siteTitle } = await import('./siteName')
  const expected = name ?? 'Communal Cache'
  expect(siteTitle('Communal Cache — Borrow from people you know')).toBe(`${expected} — Borrow from people you know`)
  expect(siteTitle('Privacy policy — Communal Cache')).toBe(`Privacy policy — ${expected}`)
  const landing = readFileSync(new URL('../pages/LandingPage.tsx', import.meta.url), 'utf8')
  const legal = readFileSync(new URL('../pages/LegalPage.tsx', import.meta.url), 'utf8')
  expect(landing).toContain('document.title = siteTitle(copy.title)')
  expect(legal).toContain('document.title = siteTitle(`${page.title} — ${copy.brand}`)')
  expect(landing).toContain('>{copy.brand}</Link>')
  expect(legal).toContain('>{copy.brand}</Link>')
})

it('sets the public build name only on the separate staging build, not production or default CI', () => {
  const staging = readFileSync(new URL('../../../.github/workflows/main.yml', import.meta.url), 'utf8')
  const production = readFileSync(new URL('../../../.github/workflows/production.yml', import.meta.url), 'utf8')
  const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const stageBuild = staging.match(/- name: Build web assets[\s\S]*?- name: Migrate and deploy staging/)![0]
  expect(stageBuild).toContain('VITE_SITE_NAME: Communal Cache Staging')
  expect(stageBuild).toContain('run: npm --prefix web run build')
  expect(production).toContain('run: npm --prefix web run build')
  expect(production).not.toContain('VITE_SITE_NAME')
  expect(ci).not.toContain('VITE_SITE_NAME')
})
