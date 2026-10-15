import { expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

const root = new URL('../../../',import.meta.url)
const config = JSON.parse(readFileSync(new URL('wrangler.jsonc',root),'utf8'))

it('preserves applied class history and appends the explicit destructive deletion for every environment', () => {
  expect(config.migrations).toEqual([
    {tag:'v1',new_sqlite_classes:['Cache']},
    {tag:'v2-retire-cache',deleted_classes:['Cache']},
  ])
  expect(config.durable_objects).toBeUndefined()
  for (const environment of ['staging','production']) {
    expect(config.env[environment].durable_objects).toBeUndefined()
    expect(config.env[environment].migrations).toBeUndefined()
    expect(config.env[environment].d1_databases[0].binding).toBe('DB')
    expect(config.env[environment].r2_buckets[0].binding).toBe('BUCKET')
    expect(config.env[environment].queues.producers[0].binding).toBe('NOTIFICATIONS')
  }
  expect(config.triggers.crons).toEqual(['*/5 * * * *'])
})

it('removes retired code and test registration while keeping the generated platform declarations separate', () => {
  for (const path of ['src/cache.ts','src/sync.ts']) expect(existsSync(new URL(path,root))).toBe(false)
  expect(readFileSync(new URL('vitest.config.ts',root),'utf8')).not.toContain('durableObjects:')
  const header = readFileSync(new URL('worker-configuration.d.ts',root),'utf8').split('// Begin runtime types')[0]
  expect(header).toContain('durableNamespaces: never')
  expect(header).not.toContain('Namespace<')
})
