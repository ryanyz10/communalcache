import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'

export default defineConfig(async () => ({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({
          main: './src/index.ts',
          remoteBindings: false,
          miniflare: {
            compatibilityDate: '2026-09-30',
            compatibilityFlags: ['nodejs_compat'],
            d1Databases: ['DB'],
            durableObjects: { CACHES: { className: 'Cache', useSQLite: true } },
            bindings: {
              APP_BASE_URL: 'https://communalcache.com',
              BETTER_AUTH_URL: 'https://communalcache.com',
              BETTER_AUTH_SECRET: 'test-only-public-fixture-not-for-deployment',
              RESEND_API_KEY: 'test-only',
              EMAIL_FROM: 'Communal Cache <signin@communalcache.com>',
              VAPID_PUBLIC_KEY: '',
              TEST_MIGRATIONS: await readD1Migrations('./migrations/d1'),
            },
          },
        })],
        test: { name: 'worker', include: ['tests/**/*.test.ts'], setupFiles: ['./tests/setup.ts'], testTimeout: 20_000 },
      },
      { test: { name: 'ui', environment: 'node', include: ['web/src/**/*.test.ts'] } },
    ],
  },
}))
