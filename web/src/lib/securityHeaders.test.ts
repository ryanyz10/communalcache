import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare'

const publicDirectory = fileURLToPath(new URL('../../public/', import.meta.url))
const source = readFileSync(new URL('../../../src/http.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} as { securityHeaders: (response: Response, origin: string, path: string) => Response } }
new Function('module', 'exports', compiled)(module, module.exports)

it('serves baseline headers on real assets without forcing all assets through the user Worker', async () => {
  const runtime = new Miniflare(convertV4MiniflareOptions({
    name: 'headers-test', modules: true, script: 'export default { fetch() { return new Response("user-worker-sentinel") } }',
    compatibilityDate: '2026-09-30', cf: false, log: new Log(LogLevel.ERROR),
    assets: { directory: publicDirectory, binding: 'ASSETS', run_worker_first: ['/api/*'], routerConfig: { has_user_worker: true } },
  }))
  try {
    for (const origin of ['https://communalcache.com', 'https://communalcache-staging.ryanyz10-be6.workers.dev', 'http://localhost:8787']) {
      const expected = module.exports.securityHeaders(new Response(null), origin, '/favicon.svg')
      for (const path of ['/favicon.svg', '/sw.js', '/fonts/caprasimo-latin.woff2']) {
        const response = await runtime.dispatchFetch(origin + path)
        expect(response.status).toBe(200)
        expect(Buffer.from(await response.arrayBuffer()).equals(readFileSync(publicDirectory + path.slice(1)))).toBe(true)
        for (const [name, value] of expected.headers) expect(response.headers.get(name), `${origin}${path}: ${name}`).toBe(value)
        expect(response.headers.get('Strict-Transport-Security')).toBe(origin.startsWith('http:') ? null : 'max-age=31536000')
      }
    }
    expect(await (await runtime.dispatchFetch('http://localhost/api/check')).text()).toBe('user-worker-sentinel')
  } finally { await runtime.dispose() }
})

it('keeps HSTS asset hosts aligned with configured HTTPS origins and existing Worker-first privacy routes', () => {
  const config = JSON.parse(readFileSync(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8'))
  const environments = [config, ...Object.values(config.env)] as { vars: { APP_BASE_URL: string } }[]
  const configured = [...new Set(environments.map(environment => environment.vars.APP_BASE_URL))].sort()
  const headers = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8')
  const hosts = [...headers.matchAll(/^(https:\/\/[^/]+)\/\*$/gm)].map(match => match[1]).sort()
  expect(hosts).toEqual(configured)
  expect(headers).not.toMatch(/includeSubDomains|preload/)
  expect(config.assets.run_worker_first).toEqual(['/api', '/api/*', '/join/*', '/auth/link', '/admin', '/admin/*'])
})
