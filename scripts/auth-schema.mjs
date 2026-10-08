// Run with node --experimental-strip-types scripts/auth-schema.mjs.
// Uses empty local D1 only; compileMigrations does not apply any schema.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { getMigrations } from 'better-auth/db/migration'
import { authOptions } from '../src/auth.ts'

const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: 'export default { fetch() { return new Response("schema reference") } }',
  compatibilityDate: '2026-09-30',
  d1Databases: ['DB'],
}))
try {
  const options = authOptions({
    DB: await mf.getD1Database('DB'),
    APP_BASE_URL: 'https://communalcache.com',
    BETTER_AUTH_URL: 'https://communalcache.com',
    // Public fixture for schema compilation only, never used for sessions.
    BETTER_AUTH_SECRET: 'schema-reference-only-not-an-auth-secret',
    RESEND_API_KEY: 'unused',
    EMAIL_FROM: 'unused',
  })
  const migrations = await getMigrations(options)
  console.log(await migrations.compileMigrations())
} finally {
  await mf.dispose()
}
